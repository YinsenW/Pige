import {
  forwardRef,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent
} from "react";

export type ReaderInlineReferenceActivation =
  | "opened_page"
  | "opened_source"
  | "not_found"
  | "ambiguous"
  | "stale"
  | "failed";

type ReaderInlineReferenceFeedback =
  | "resolving"
  | "not_found"
  | "ambiguous"
  | "stale"
  | "failed";

type ReaderCodeCopyStatus = "copying" | "copied" | "failed";

export const ReaderInlineReferenceSurface = forwardRef<HTMLDivElement, {
  readonly pageIdentity: string;
  readonly html: string;
  readonly onActivate?: (href: string) => Promise<ReaderInlineReferenceActivation>;
  readonly onUnavailable: () => void;
  readonly t: (key: string) => string;
}>(function ReaderInlineReferenceSurface(props, forwardedRef): React.JSX.Element {
  const readyDescriptionId = useId();
  const unavailableDescriptionId = useId();
  const feedbackId = useId();
  const ownRef = useRef<HTMLDivElement | null>(null);
  const requestSequenceRef = useRef(0);
  const codeCopySequenceRef = useRef(0);
  const codeCopyActiveRef = useRef(false);
  const pageIdentityRef = useRef(props.pageIdentity);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ReaderInlineReferenceFeedback | null>(null);
  const sanitizedMarkup = useMemo(() => ({ __html: props.html }), [props.html]);

  useLayoutEffect(() => {
    pageIdentityRef.current = props.pageIdentity;
    requestSequenceRef.current += 1;
    codeCopySequenceRef.current += 1;
    codeCopyActiveRef.current = false;
    setActiveHref(null);
    setFeedback(null);
  }, [props.pageIdentity, props.html]);

  useLayoutEffect(() => {
    const root = ownRef.current;
    if (!root) return;
    const document = root.ownerDocument;
    Array.from(root.querySelectorAll<HTMLPreElement>("pre")).forEach((pre, index) => {
      let wrapper = pre.closest<HTMLElement>("[data-reader-code-index]");
      if (!wrapper) {
        wrapper = document.createElement("div");
        wrapper.className = "conversation-code-block reader-code-block";
        pre.replaceWith(wrapper);
        const header = document.createElement("div");
        header.className = "conversation-code-header";
        const language = document.createElement("span");
        language.className = "conversation-code-language";
        const button = document.createElement("button");
        button.type = "button";
        button.dataset.readerCodeCopy = "true";
        const status = document.createElement("span");
        status.className = "visually-hidden reader-code-copy-status";
        status.setAttribute("role", "status");
        status.setAttribute("aria-live", "polite");
        header.append(language, button, status);
        wrapper.append(header, pre);
      }
      wrapper.dataset.readerCodeIndex = String(index);
      const code = pre.querySelector("code");
      const languageClass = code
        ? Array.from(code.classList).find((className) => className.startsWith("language-"))
        : undefined;
      const language = languageClass?.slice("language-".length).trim();
      const languageNode = wrapper.querySelector<HTMLElement>(".conversation-code-language");
      if (languageNode) languageNode.textContent = language || props.t("conversation.code");
      updateCodeCopyPresentation(wrapper, null, props.t);
    });
  }, [props.html, props.pageIdentity, props.t]);

  useLayoutEffect(() => {
    const links = internalReferenceLinks(ownRef.current);
    for (const link of links) {
      const href = link.getAttribute("href");
      const isActive = href !== null && href === activeHref;
      const requestInFlight = feedback === "resolving";
      const state = requestInFlight
        ? "resolving"
        : isActive && feedback
          ? feedback
          : props.onActivate
            ? "ready"
            : "unavailable";
      link.dataset.readerLinkState = state;
      link.setAttribute(
        "aria-describedby",
        requestInFlight || isActive && feedback
          ? feedbackId
          : props.onActivate
            ? readyDescriptionId
            : unavailableDescriptionId
      );
      if (requestInFlight) {
        link.setAttribute("aria-disabled", "true");
        if (isActive) link.setAttribute("aria-busy", "true");
        else link.removeAttribute("aria-busy");
      } else {
        link.removeAttribute("aria-busy");
        link.removeAttribute("aria-disabled");
      }
    }
    return () => {
      for (const link of links) {
        delete link.dataset.readerLinkState;
        link.removeAttribute("aria-describedby");
        link.removeAttribute("aria-busy");
        link.removeAttribute("aria-disabled");
      }
    };
  }, [activeHref, feedback, feedbackId, props.html, props.onActivate, readyDescriptionId, unavailableDescriptionId]);

  const activate = async (event: ReactMouseEvent<HTMLDivElement>): Promise<void> => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const copyButton = target.closest<HTMLButtonElement>("[data-reader-code-copy]");
    if (copyButton && event.button === 0) {
      event.preventDefault();
      event.stopPropagation();
      if (codeCopyActiveRef.current) return;
      const wrapper = copyButton.closest<HTMLElement>("[data-reader-code-index]");
      const index = Number(wrapper?.dataset.readerCodeIndex);
      const code = wrapper?.querySelector<HTMLElement>("pre code")?.textContent;
      if (!wrapper || !Number.isSafeInteger(index) || index < 0 || code === undefined) return;
      codeCopyActiveRef.current = true;
      const sequence = codeCopySequenceRef.current + 1;
      codeCopySequenceRef.current = sequence;
      const pageIdentity = props.pageIdentity;
      updateCodeCopyPresentation(wrapper, "copying", props.t);
      try {
        const clipboard = ownRef.current?.ownerDocument.defaultView?.navigator.clipboard;
        if (!clipboard?.writeText) throw new Error("Clipboard unavailable");
        await clipboard.writeText(code);
        if (sequence !== codeCopySequenceRef.current || pageIdentity !== pageIdentityRef.current) return;
        updateCodeCopyPresentation(wrapper, "copied", props.t);
      } catch {
        if (sequence !== codeCopySequenceRef.current || pageIdentity !== pageIdentityRef.current) return;
        updateCodeCopyPresentation(wrapper, "failed", props.t);
      } finally {
        if (sequence === codeCopySequenceRef.current && pageIdentity === pageIdentityRef.current) {
          codeCopyActiveRef.current = false;
        }
      }
      return;
    }
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !event.currentTarget.contains(link)) return;
    const href = link.getAttribute("href") ?? "";
    if (!isInternalReferenceCandidate(href)) return;
    event.preventDefault();
    event.stopPropagation();

    if (!props.onActivate) {
      props.onUnavailable();
      return;
    }
    if (feedback === "resolving") return;
    if (!isValidInternalReference(href)) {
      requestSequenceRef.current += 1;
      setActiveHref(href);
      setFeedback("failed");
      return;
    }

    const requestSequence = ++requestSequenceRef.current;
    const pageIdentity = props.pageIdentity;
    setActiveHref(href);
    setFeedback("resolving");
    let outcome: ReaderInlineReferenceActivation;
    try {
      outcome = await props.onActivate(href);
    } catch {
      outcome = "failed";
    }
    if (
      requestSequence !== requestSequenceRef.current ||
      pageIdentity !== pageIdentityRef.current
    ) return;
    if (outcome === "opened_page" || outcome === "opened_source") {
      setActiveHref(null);
      setFeedback(null);
      return;
    }
    setFeedback(outcome);
  };

  return (
    <div className="reader-inline-reference-surface">
      <p id={readyDescriptionId} hidden>{props.t("note.readerLinkReady")}</p>
      <p id={unavailableDescriptionId} hidden>{props.t("note.readerLinkUnavailable")}</p>
      <p
        className={`reader-inline-reference-feedback${feedback ? ` ${feedback}` : ""}`}
        id={feedbackId}
        hidden={!feedback}
        role={feedback ? "status" : undefined}
        aria-live="polite"
        aria-atomic="true"
        data-reader-reference-feedback={feedback ?? undefined}
      >
        {feedback ? props.t(`note.readerLink.${feedback}`) : ""}
      </p>
      <div
        ref={(element) => {
          ownRef.current = element;
          if (typeof forwardedRef === "function") forwardedRef(element);
          else if (forwardedRef) forwardedRef.current = element;
        }}
        className="markdown-body"
        onClickCapture={(event) => void activate(event)}
        onAuxClickCapture={(event) => void activate(event)}
        // HTML is produced by the main-process Markdown renderer after sanitization.
        dangerouslySetInnerHTML={sanitizedMarkup}
      />
    </div>
  );
});

function internalReferenceLinks(root: HTMLElement | null): readonly HTMLAnchorElement[] {
  return Array.from(root?.querySelectorAll<HTMLAnchorElement>('a[href^="#wiki:"], a[href^="#source:"]') ?? []);
}

function isInternalReferenceCandidate(href: string): boolean {
  return href.startsWith("#wiki:") || href.startsWith("#source:");
}

function isValidInternalReference(href: string): boolean {
  return href.length <= 1_024 && !/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(href);
}

function updateCodeCopyPresentation(
  wrapper: HTMLElement,
  status: ReaderCodeCopyStatus | null,
  t: (key: string) => string
): void {
  const label = status === "copying"
    ? t("conversation.copyingCode")
    : status === "copied"
      ? t("conversation.codeCopied")
      : status === "failed"
        ? t("conversation.copyCodeFailed")
        : t("conversation.copyCode");
  const button = wrapper.querySelector<HTMLButtonElement>("[data-reader-code-copy]");
  if (button) {
    button.textContent = label;
    button.disabled = status === "copying";
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
    if (status === "copying") button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }
  const statusNode = wrapper.querySelector<HTMLElement>(".reader-code-copy-status");
  if (statusNode) statusNode.textContent = status === "copied" || status === "failed" ? label : "";
}
