import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject
} from "react";
import { createPortal } from "react-dom";

const MESSAGE_SELECTOR = ".conversation-timeline-content > .conversation-message";
const PREVIEW_MAX_CODE_POINTS = 160;
const RAIL_EDGE_INSET = 5;
const RAIL_MIN_HEIGHT = 24;
const RAIL_ANCHOR_PITCH = 3;

type ConversationAnchor = {
  readonly element: HTMLElement;
  readonly key: string;
  readonly preview: string;
  readonly position: number;
};

type ConversationRailLayout = {
  readonly top: number;
  readonly right: number;
  readonly height: number;
};

interface ConversationScrollRailProps {
  readonly timelineRef: RefObject<HTMLElement | null>;
  readonly t: (key: string) => string;
}

export function ConversationScrollRail({ timelineRef, t }: ConversationScrollRailProps) {
  const railRef = useRef<HTMLElement | null>(null);
  const [anchors, setAnchors] = useState<readonly ConversationAnchor[]>([]);
  const [layout, setLayout] = useState<ConversationRailLayout | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [engagedIndex, setEngagedIndex] = useState<number | null>(null);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (!timeline) return;
    let animationFrame = 0;

    const measure = (): void => {
      animationFrame = 0;
      const messages = Array.from(
        timeline.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR)
      );
      const overflowing = messages.length > 1 && timeline.scrollHeight > timeline.clientHeight + 1;
      timeline.classList.toggle("has-conversation-scroll-rail", overflowing);
      if (!overflowing) {
        setAnchors([]);
        setLayout(null);
        return;
      }

      const nextAnchors = messages.map((element, index) => ({
        element,
        key: element.dataset.messageId ??
          element.dataset.clientTurnId ??
          `${element.dataset.agentConversationState ?? "message"}-${index}`,
        preview: messagePreview(element, t),
        position: messages.length === 1 ? 0.5 : index / (messages.length - 1)
      }));
      const rect = timeline.getBoundingClientRect();
      const railHeight = Math.min(
        rect.height,
        Math.max(RAIL_MIN_HEIGHT, RAIL_EDGE_INSET * 2 + (nextAnchors.length - 1) * RAIL_ANCHOR_PITCH)
      );
      setAnchors(nextAnchors);
      setLayout({
        top: Math.round(rect.top + (rect.height - railHeight) / 2),
        right: Math.max(2, Math.round(window.innerWidth - rect.right + 2)),
        height: Math.round(railHeight)
      });
      setActiveIndex(currentAnchorIndex(nextAnchors, timeline));
    };

    const scheduleMeasure = (): void => {
      if (animationFrame !== 0) return;
      animationFrame = window.requestAnimationFrame(measure);
    };
    const handleScroll = (): void => {
      setActiveIndex((current) => {
        const next = currentAnchorIndexFromElements(timeline);
        return next < 0 ? current : next;
      });
    };

    measure();
    timeline.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    const mutationObserver = new window.MutationObserver(scheduleMeasure);
    mutationObserver.observe(timeline, { childList: true, subtree: true, characterData: true });
    const resizeObserver = typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(scheduleMeasure)
      : null;
    resizeObserver?.observe(timeline);
    const content = timeline.querySelector<HTMLElement>(".conversation-timeline-content");
    if (content) resizeObserver?.observe(content);

    return () => {
      if (animationFrame !== 0) window.cancelAnimationFrame(animationFrame);
      timeline.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", scheduleMeasure);
      mutationObserver.disconnect();
      resizeObserver?.disconnect();
      timeline.classList.remove("has-conversation-scroll-rail");
    };
  }, [t, timelineRef]);

  if (!layout || anchors.length === 0) return null;

  const style = {
    "--conversation-rail-top": `${layout.top}px`,
    "--conversation-rail-right": `${layout.right}px`,
    "--conversation-rail-height": `${layout.height}px`
  } as CSSProperties;

  const activate = (index: number): void => {
    const timeline = timelineRef.current;
    const anchor = anchors[index];
    if (!timeline || !anchor) return;
    const targetTop = index === 0
      ? 0
      : index === anchors.length - 1
        ? timeline.scrollHeight - timeline.clientHeight
        : anchor.element.offsetTop -
          Math.max(0, (timeline.clientHeight - anchor.element.offsetHeight) / 2);
    timeline.scrollTo({
      top: Math.max(0, targetTop),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
    setActiveIndex(index);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = Math.max(0, index - 1);
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = Math.min(anchors.length - 1, index + 1);
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = anchors.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const button = railRef.current?.querySelectorAll<HTMLButtonElement>(".conversation-scroll-anchor")[nextIndex];
    button?.focus();
    setEngagedIndex(nextIndex);
    activate(nextIndex);
  };

  const pointerIndex = (event: ReactMouseEvent<HTMLElement>): number => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = clamp(
      (event.clientY - rect.top - RAIL_EDGE_INSET) /
        Math.max(1, rect.height - RAIL_EDGE_INSET * 2),
      0,
      1
    );
    return Math.round(position * (anchors.length - 1));
  };

  return createPortal((
    <nav
      ref={railRef}
      className="conversation-scroll-rail"
      style={style}
      aria-label={t("home.scrollRailLabel")}
      data-conversation-scroll-rail="true"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        activate(pointerIndex(event));
      }}
      onMouseLeave={() => setEngagedIndex(null)}
      onMouseMove={(event) => setEngagedIndex(pointerIndex(event))}
    >
      {anchors.map((anchor, index) => {
        const distance = engagedIndex === null ? Number.POSITIVE_INFINITY : Math.abs(engagedIndex - index);
        return (
          <button
            type="button"
            className={`conversation-scroll-anchor${distance === 0 ? " is-engaged" : ""}${distance === 1 ? " neighbor-one" : ""}${distance === 2 ? " neighbor-two" : ""}${distance === 3 ? " neighbor-three" : ""}`}
            style={{
              "--conversation-anchor-position": anchor.position,
              "--conversation-anchor-opacity": anchorEdgeOpacity(anchor.position)
            } as CSSProperties}
            aria-label={`${t("home.scrollRailJump")} ${index + 1}/${anchors.length}`}
            aria-current={index === activeIndex ? "true" : undefined}
            aria-describedby={engagedIndex === index ? `conversation-scroll-preview-${index}` : undefined}
            tabIndex={index === activeIndex ? 0 : -1}
            key={anchor.key}
            onClick={() => activate(index)}
            onFocus={() => setEngagedIndex(index)}
            onBlur={() => setEngagedIndex(null)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            <span className="conversation-scroll-anchor-mark" aria-hidden="true" />
            {engagedIndex === index ? (
              <span
                id={`conversation-scroll-preview-${index}`}
                className="conversation-scroll-anchor-preview"
                role="tooltip"
              >
                {anchor.preview}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  ), document.body);
}

function currentAnchorIndex(
  anchors: readonly ConversationAnchor[],
  timeline: HTMLElement
): number {
  if (anchors.length === 0) return 0;
  if (timeline.scrollTop <= 16) return 0;
  if (timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 16) {
    return anchors.length - 1;
  }
  const viewportTarget = timeline.scrollTop + timeline.clientHeight * 0.42;
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;
  anchors.forEach((anchor, index) => {
    const center = anchor.element.offsetTop + anchor.element.offsetHeight / 2;
    const distance = Math.abs(center - viewportTarget);
    if (distance < closestDistance) {
      closestIndex = index;
      closestDistance = distance;
    }
  });
  return closestIndex;
}

function currentAnchorIndexFromElements(timeline: HTMLElement): number {
  const elements = Array.from(timeline.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR));
  if (elements.length === 0) return -1;
  return currentAnchorIndex(elements.map((element, index) => ({
    element,
    key: String(index),
    preview: "",
    position: 0
  })), timeline);
}

function messagePreview(element: HTMLElement, t: (key: string) => string): string {
  const previewSources = Array.from(element.querySelectorAll<HTMLElement>(
    ".conversation-markdown, .conversation-attachment, .conversation-status-content"
  ));
  const text = (previewSources.length > 0
    ? previewSources.map((source) => source.textContent ?? "").join(" ")
    : element.textContent ?? "").replace(/\s+/gu, " ").trim();
  const fallback = t("home.scrollRailMessageFallback");
  if (text.length === 0) return fallback;
  const codePoints = Array.from(text);
  return codePoints.length > PREVIEW_MAX_CODE_POINTS
    ? `${codePoints.slice(0, PREVIEW_MAX_CODE_POINTS).join("")}…`
    : text;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function anchorEdgeOpacity(position: number): number {
  const edgeDistance = Math.min(position, 1 - position);
  return Number(clamp(0.18 + edgeDistance / 0.13, 0.18, 1).toFixed(3));
}
