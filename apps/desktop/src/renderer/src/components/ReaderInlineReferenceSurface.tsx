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
  const pageIdentityRef = useRef(props.pageIdentity);
  const [activeHref, setActiveHref] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<ReaderInlineReferenceFeedback | null>(null);
  const sanitizedMarkup = useMemo(() => ({ __html: props.html }), [props.html]);

  useLayoutEffect(() => {
    pageIdentityRef.current = props.pageIdentity;
    requestSequenceRef.current += 1;
    setActiveHref(null);
    setFeedback(null);
  }, [props.pageIdentity, props.html]);

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
