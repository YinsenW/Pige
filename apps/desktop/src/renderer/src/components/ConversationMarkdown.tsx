import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

type RenderedConversationMarkdown = {
  readonly source: string;
  readonly html: string | null;
};

let markdownRendererPromise: Promise<(
  markdown: string
) => Promise<{ readonly html: string }>> | undefined;

function renderConversationMarkdown(markdown: string): Promise<{ readonly html: string }> {
  markdownRendererPromise ??= import("@pige/markdown")
    .then(({ renderPigeMarkdownToHtml }) => renderPigeMarkdownToHtml);
  return markdownRendererPromise.then((renderMarkdown) => renderMarkdown(markdown));
}

export function ConversationMarkdown(props: {
  readonly markdown: string;
  readonly provisional?: boolean;
}): React.JSX.Element {
  const [rendered, setRendered] = useState<RenderedConversationMarkdown | null>(null);

  useEffect(() => {
    let current = true;
    const source = props.markdown;
    void renderConversationMarkdown(source)
      .then((rendered) => {
        if (current) setRendered({ source, html: rendered.html });
      })
      .catch(() => {
        if (current) setRendered({ source, html: null });
      });
    return () => {
      current = false;
    };
  }, [props.markdown]);

  const preventConversationNavigation = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest("a")) event.preventDefault();
  };

  const updating = rendered !== null && rendered.source !== props.markdown;
  if (rendered === null || rendered.html === null) {
    return (
      <div
        className="conversation-markdown"
        data-markdown-ready="false"
        data-markdown-updating={updating ? "true" : undefined}
      >
        <p>{props.markdown}</p>
      </div>
    );
  }

  return (
    <div
      className={`conversation-markdown${props.provisional ? " provisional-markdown" : ""}`}
      data-markdown-ready="true"
      data-markdown-updating={updating ? "true" : undefined}
      onClick={preventConversationNavigation}
      dangerouslySetInnerHTML={{ __html: rendered.html ?? "" }}
    />
  );
}
