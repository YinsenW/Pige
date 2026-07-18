import {
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

export function ConversationMarkdown(props: {
  readonly markdown: string;
  readonly provisional?: boolean;
}): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setHtml(null);
    void import("@pige/markdown")
      .then(({ renderPigeMarkdownToHtml }) => renderPigeMarkdownToHtml(props.markdown))
      .then((rendered) => {
        if (current) setHtml(rendered.html);
      })
      .catch(() => {
        if (current) setHtml(null);
      });
    return () => {
      current = false;
    };
  }, [props.markdown]);

  const preventConversationNavigation = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest("a")) event.preventDefault();
  };

  if (html === null) {
    return (
      <div className="conversation-markdown" data-markdown-ready="false">
        <p>{props.markdown}</p>
      </div>
    );
  }

  return (
    <div
      className={`conversation-markdown${props.provisional ? " provisional-markdown" : ""}`}
      data-markdown-ready="true"
      onClick={preventConversationNavigation}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
