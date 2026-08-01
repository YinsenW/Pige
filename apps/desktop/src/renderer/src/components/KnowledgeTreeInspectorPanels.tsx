import type {
  KnowledgeTreeNode,
  LibraryRelatedPage,
  LibraryRelatedResult
} from "@pige/contracts";

export type KnowledgeTreeRelatedState = LibraryRelatedResult | "loading" | "unavailable" | null;

type KnowledgeTreeBranchNode = {
  readonly id: string;
  readonly title: string;
  readonly kind: KnowledgeTreeNode["kind"] | "page" | "root";
};

export function KnowledgeTreeBranchPanel<T extends KnowledgeTreeBranchNode>(props: {
  readonly children: readonly T[];
  readonly onSelect: (node: T) => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  return (
    <section className="knowledge-branch-browser" aria-label={props.t("knowledgeTree.branchContents")}>
      <h3>{props.t("knowledgeTree.branchContents")}</h3>
      {props.children.length === 0 ? (
        <p className="related-empty">{props.t("knowledgeTree.branchEmpty")}</p>
      ) : (
        <div className="knowledge-branch-list">
          {props.children.map((node) => (
            <button
              key={node.id}
              type="button"
              data-knowledge-action="browse-child"
              aria-label={`${props.t("knowledgeTree.browseBranch")}: ${node.title}`}
              onClick={() => props.onSelect(node)}
            >
              <span>{node.title}</span>
              <small>{node.kind === "page"
                ? props.t("knowledgeTree.supportingPage")
                : props.t(`knowledgeTree.kind.${node.kind}`)}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

export function KnowledgeTreeRelatedPanel(props: {
  readonly state: KnowledgeTreeRelatedState;
  readonly ownerFocusKey: string;
  readonly noteLoadingPageId: string | null;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  if (props.state === "loading" || props.state === "unavailable") {
    return (
      <section className="related-group" aria-live="polite" aria-busy={props.state === "loading"}>
        <h3>{props.t("knowledgeTree.related")}</h3>
        <p className="related-empty">
          {props.t(props.state === "loading" ? "knowledgeTree.relatedLoading" : "knowledgeTree.relatedUnavailable")}
        </p>
      </section>
    );
  }
  if (!props.state || props.state.degraded) {
    return (
      <section className="related-group" aria-live="polite">
        <h3>{props.t("knowledgeTree.related")}</h3>
        <p className="related-empty">
          {props.t(props.state?.degraded ? "knowledgeTree.relatedUnavailable" : "knowledgeTree.relatedEmpty")}
        </p>
      </section>
    );
  }
  if (props.state.outgoing.length + props.state.backlinks.length === 0) {
    return (
      <section className="related-group" aria-live="polite">
        <h3>{props.t("knowledgeTree.related")}</h3>
        <p className="related-empty">{props.t("knowledgeTree.relatedEmpty")}</p>
      </section>
    );
  }
  return (
    <section className="related-group" aria-label={props.t("knowledgeTree.related")}>
      <KnowledgeTreeRelatedGroup title={props.t("knowledgeTree.outgoing")} pages={props.state.outgoing} {...props} />
      <KnowledgeTreeRelatedGroup title={props.t("knowledgeTree.backlinks")} pages={props.state.backlinks} {...props} />
    </section>
  );
}

function KnowledgeTreeRelatedGroup(props: {
  readonly title: string;
  readonly pages: readonly LibraryRelatedPage[];
  readonly ownerFocusKey: string;
  readonly noteLoadingPageId: string | null;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  if (props.pages.length === 0) return null;
  return (
    <section className="related-group">
      <h3>{props.title}</h3>
      <div className="related-list">
        {props.pages.map(({ relation, relationType, summary }) => {
          const focusKey = `${props.ownerFocusKey}:${relation}:${relationType}:${summary.pageId}`;
          return (
            <article className="related-row" key={`${relation}:${relationType}:${summary.pageId}`}>
              <div><strong>{summary.title}</strong>{relationType === "contradicts" || relationType === "answers"
                ? <span>{props.t(`note.relatedType.${relationType}`)}</span> : null}</div>
              <button
                type="button"
                className="ghost"
                data-knowledge-open-key={focusKey}
                aria-label={`${props.t("note.open")}: ${summary.title}`}
                disabled={props.noteLoadingPageId === summary.pageId}
                onClick={() => void props.onOpenNote(summary.pageId, focusKey)}
              >
                {props.noteLoadingPageId === summary.pageId ? props.t("note.opening") : props.t("note.open")}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
