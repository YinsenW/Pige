import { useLayoutEffect, useRef, useState } from "react";
import { PigeIcon } from "./PigeIcon";

const MAX_READER_OUTLINE_HEADINGS = 32;
const MAX_READER_OUTLINE_LABEL_CODE_POINTS = 120;

type ReaderOutlineHeading = {
  readonly key: string;
  readonly label: string;
  readonly level: 2 | 3;
  readonly pageIdentity: string;
};

export function ReaderDocumentOutline(props: {
  readonly contentRoot: HTMLDivElement | null;
  readonly pageIdentity: string;
  readonly html: string;
  readonly t: (key: string) => string;
}): React.JSX.Element | null {
  const [headings, setHeadings] = useState<readonly ReaderOutlineHeading[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const buttonRefs = useRef(new Map<number, HTMLButtonElement>());
  const pageIdentityRef = useRef(props.pageIdentity);
  pageIdentityRef.current = props.pageIdentity;

  useLayoutEffect(() => {
    const root = props.contentRoot;
    setExpanded(false);
    setFocusIndex(0);
    if (!root) {
      setHeadings([]);
      return;
    }
    const candidates = Array.from(root.querySelectorAll<HTMLHeadingElement>("h2, h3"));
    const annotated: Array<{ heading: HTMLHeadingElement; data: string | undefined; tabIndex: string | null }> = [];
    const next = candidates.flatMap((heading, index) => {
      if (annotated.length >= MAX_READER_OUTLINE_HEADINGS) return [];
      const label = boundedHeadingLabel(heading.textContent ?? "");
      if (!label) return [];
      const key = `reader-outline-heading-${index}`;
      annotated.push({
        heading,
        data: heading.dataset.readerOutlineHeading,
        tabIndex: heading.getAttribute("tabindex")
      });
      heading.dataset.readerOutlineHeading = key;
      heading.tabIndex = -1;
      return [{
        key,
        label,
        level: heading.tagName === "H2" ? 2 as const : 3 as const,
        pageIdentity: props.pageIdentity
      }];
    });
    setHeadings(next);
    return () => {
      for (const previous of annotated) {
        if (previous.data === undefined) delete previous.heading.dataset.readerOutlineHeading;
        else previous.heading.dataset.readerOutlineHeading = previous.data;
        if (previous.tabIndex === null) previous.heading.removeAttribute("tabindex");
        else previous.heading.setAttribute("tabindex", previous.tabIndex);
      }
    };
  }, [props.contentRoot, props.html, props.pageIdentity]);

  if (headings.length < 2) return null;

  const focusButton = (index: number): void => {
    const nextIndex = Math.max(0, Math.min(index, headings.length - 1));
    setFocusIndex(nextIndex);
    buttonRefs.current.get(nextIndex)?.focus({ preventScroll: true });
  };

  const openHeading = (heading: ReaderOutlineHeading): void => {
    if (heading.pageIdentity !== pageIdentityRef.current) return;
    const root = props.contentRoot;
    const target = Array.from(root?.querySelectorAll<HTMLHeadingElement>("h2, h3") ?? [])
      .find((candidate) => candidate.dataset.readerOutlineHeading === heading.key);
    if (!target || boundedHeadingLabel(target.textContent ?? "") !== heading.label) return;
    target.scrollIntoView?.({ block: "center", inline: "nearest" });
    target.focus({ preventScroll: true });
  };

  return (
    <nav className="reader-document-outline" aria-label={props.t("note.outline.title")}>
      <button
        type="button"
        className="reader-document-outline-toggle"
        aria-expanded={expanded}
        title={props.t(expanded ? "note.outline.collapse" : "note.outline.expand")}
        onClick={() => setExpanded((current) => !current)}
      >
        <PigeIcon name="listTree" size={15} />
        <span>{props.t("note.outline.title")}</span>
        <PigeIcon name={expanded ? "collapse" : "expand"} size={14} aria-hidden="true" />
      </button>
      {expanded ? (
        <ol className="reader-document-outline-list" onKeyDown={(event) => {
          let nextIndex: number | null = null;
          if (event.key === "ArrowDown") nextIndex = (focusIndex + 1) % headings.length;
          else if (event.key === "ArrowUp") nextIndex = (focusIndex - 1 + headings.length) % headings.length;
          else if (event.key === "Home") nextIndex = 0;
          else if (event.key === "End") nextIndex = headings.length - 1;
          if (nextIndex === null) return;
          event.preventDefault();
          focusButton(nextIndex);
        }}>
          {headings.map((heading, index) => (
            <li key={heading.key} data-heading-level={heading.level}>
              <button
                ref={(element) => {
                  if (element) buttonRefs.current.set(index, element);
                  else buttonRefs.current.delete(index);
                }}
                type="button"
                tabIndex={focusIndex === index ? 0 : -1}
                onFocus={() => setFocusIndex(index)}
                onClick={() => openHeading(heading)}
              >
                {heading.label}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </nav>
  );
}

function boundedHeadingLabel(value: string): string {
  return Array.from(value.replace(/\s+/gu, " ").trim())
    .slice(0, MAX_READER_OUTLINE_LABEL_CODE_POINTS)
    .join("");
}
