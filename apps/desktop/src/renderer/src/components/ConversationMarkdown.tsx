import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

type RenderedConversationMarkdown = {
  readonly source: string;
  readonly html: string | null;
};

type CodeCopyFeedback = {
  readonly source: string;
  readonly index: number;
  readonly status: "copying" | "copied" | "failed";
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
  readonly t?: (key: string) => string;
}): React.JSX.Element {
  const [rendered, setRendered] = useState<RenderedConversationMarkdown | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const codeCopyFeedbackRef = useRef<CodeCopyFeedback | null>(null);
  const codeCopySequenceRef = useRef(0);

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

  useEffect(() => {
    codeCopySequenceRef.current += 1;
    codeCopyFeedbackRef.current = null;
  }, [props.markdown]);

  useEffect(() => () => {
    codeCopySequenceRef.current += 1;
  }, []);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const translate = props.t;
    const codeBlocksReady = Boolean(
      translate &&
      !props.provisional &&
      rendered?.html !== null &&
      rendered?.source === props.markdown
    );
    if (!codeBlocksReady || !translate) {
      for (const wrapper of root.querySelectorAll<HTMLElement>(".conversation-code-block")) {
        const pre = wrapper.querySelector(":scope > pre");
        if (pre) wrapper.replaceWith(pre);
      }
      return;
    }

    const preElements = Array.from(root.querySelectorAll<HTMLPreElement>("pre"));
    preElements.forEach((pre, index) => {
      let wrapper = pre.closest<HTMLElement>(".conversation-code-block");
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "conversation-code-block";
        pre.replaceWith(wrapper);
        const header = document.createElement("div");
        header.className = "conversation-code-header";
        const language = document.createElement("span");
        language.className = "conversation-code-language";
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.conversationCodeCopy = "true";
        const status = document.createElement("span");
        status.className = "visually-hidden conversation-code-copy-status";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        header.append(language, button, status);
        wrapper.append(header, pre);
      }
      wrapper.dataset.conversationCodeIndex = String(index);
      const code = pre.querySelector("code");
      const languageClass = code
        ? Array.from(code.classList).find((className) => className.startsWith("language-"))
        : undefined;
      const language = languageClass?.slice("language-".length).trim();
      const languageNode = wrapper.querySelector<HTMLElement>(".conversation-code-language");
      if (languageNode) languageNode.textContent = language || translate("conversation.code");

      const feedback = codeCopyFeedbackRef.current;
      const status = feedback?.source === props.markdown && feedback.index === index
        ? feedback.status
        : null;
      updateCodeCopyPresentation(wrapper, status, translate);
    });
  }, [props.markdown, props.provisional, props.t, rendered]);

  const copyCodeBlock = async (index: number): Promise<void> => {
    if (!props.t || props.provisional || rendered?.source !== props.markdown) return;
    const code = rootRef.current
      ?.querySelector<HTMLElement>(`[data-conversation-code-index="${index}"] code`)
      ?.textContent;
    if (code === undefined) return;
    const sequence = codeCopySequenceRef.current + 1;
    codeCopySequenceRef.current = sequence;
    updateCodeCopyFeedback(rootRef.current, codeCopyFeedbackRef, props.markdown, index, "copying", props.t);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(code);
      if (sequence !== codeCopySequenceRef.current) return;
      updateCodeCopyFeedback(rootRef.current, codeCopyFeedbackRef, props.markdown, index, "copied", props.t);
    } catch {
      if (sequence !== codeCopySequenceRef.current) return;
      updateCodeCopyFeedback(rootRef.current, codeCopyFeedbackRef, props.markdown, index, "failed", props.t);
    }
  };

  const handleConversationClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target instanceof Element ? event.target : null;
    const copyButton = target?.closest<HTMLButtonElement>("[data-conversation-code-copy]");
    if (copyButton) {
      event.preventDefault();
      const wrapper = copyButton.closest<HTMLElement>("[data-conversation-code-index]");
      const index = Number(wrapper?.dataset.conversationCodeIndex);
      if (Number.isSafeInteger(index) && index >= 0) void copyCodeBlock(index);
      return;
    }
    if (target?.closest("a")) event.preventDefault();
  };

  const updating = rendered !== null && rendered.source !== props.markdown;
  if (rendered === null || rendered.html === null) {
    return (
      <div
        ref={rootRef}
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
      ref={rootRef}
      className={`conversation-markdown${props.provisional ? " provisional-markdown" : ""}`}
      data-markdown-ready="true"
      data-markdown-updating={updating ? "true" : undefined}
      onClick={handleConversationClick}
      dangerouslySetInnerHTML={{ __html: rendered.html ?? "" }}
    />
  );
}

function updateCodeCopyFeedback(
  root: HTMLDivElement | null,
  feedbackRef: { current: CodeCopyFeedback | null },
  source: string,
  index: number,
  status: CodeCopyFeedback["status"],
  t: (key: string) => string
): void {
  feedbackRef.current = { source, index, status };
  const wrapper = root?.querySelector<HTMLElement>(`[data-conversation-code-index="${index}"]`);
  if (wrapper) updateCodeCopyPresentation(wrapper, status, t);
}

function updateCodeCopyPresentation(
  wrapper: HTMLElement,
  status: CodeCopyFeedback["status"] | null,
  t: (key: string) => string
): void {
  const label = status === "copying"
    ? t("conversation.copyingCode")
    : status === "copied"
      ? t("conversation.codeCopied")
      : status === "failed"
        ? t("conversation.copyCodeFailed")
        : t("conversation.copyCode");
  const button = wrapper.querySelector<HTMLButtonElement>("[data-conversation-code-copy]");
  if (button) {
    button.textContent = label;
    button.disabled = status === "copying";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    if (status === "copying") button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }
  const statusNode = wrapper.querySelector<HTMLElement>(".conversation-code-copy-status");
  if (statusNode) statusNode.textContent = status === "copied" || status === "failed" ? label : "";
}
