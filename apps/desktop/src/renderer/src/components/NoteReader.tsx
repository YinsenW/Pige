import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  LibraryRelatedResult,
  NoteOpenSourceReferenceRequest, NoteOpenSourceReferenceResult,
  NoteReconnectOriginalSourceRequest, NoteReconnectOriginalSourceResult,
  NoteRenderResult,
  ReaderSelectionActionRequest,
  ReaderSelectionActionResult,
  ReaderSelectionCreateNoteRequest, ReaderSelectionCreateNoteResult, ReaderSelectionCreatePageAction,
  ReaderSelectionEndpoint,
  ReaderSelectionIdentity,
  ReaderSelectionLinkRequest,
  ReaderSelectionLinkResult,
  ReaderSelectionResolveRequest,
  ReaderSelectionResolveResult,
  ReaderSelectionTransformRequest,
  ReaderSelectionTransformResult
} from "@pige/contracts";
import type { Locale } from "@pige/schemas";
import { ReaderInlineReferenceSurface, type ReaderInlineReferenceActivation } from "./ReaderInlineReferenceSurface";
import { NoteReaderSourceActions, ReaderSourceRevealAction, readerSourceActionLabels } from "./ReaderSourceActions";
import { ReaderSelectionAskDialog, createReaderSelectionActionRequestId, createReaderSelectionAgentTurnId, useReaderSelectionAskState } from "./ReaderSelectionAskDialog"; import { ReaderSelectionCreateChooser } from "./ReaderSelectionCreateChooser";
import { NoteRelatedPanel, type NoteRelatedState } from "./NoteRelatedPanel";
export type { NoteRelatedState } from "./NoteRelatedPanel";

function readerSelectionEndpoint(
  reader: HTMLElement | null,
  node: Node | null,
  offset: number
): ReaderSelectionEndpoint | null {
  if (!reader || !node || !Number.isInteger(offset) || offset < 0) return null;
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  const segment = element?.closest<HTMLElement>("[data-pige-selection-segment]");
  if (!segment || !reader.contains(segment)) return null;
  const segmentId = segment.dataset.pigeSelectionSegment;
  if (!segmentId || !/^readerseg_[a-f0-9]{16}$/u.test(segmentId)) return null;
  try {
    const range = reader.ownerDocument.createRange();
    range.selectNodeContents(segment);
    range.setEnd(node, offset);
    return { segmentId, utf16Offset: range.toString().length };
  } catch {
    return null;
  }
}

function createReaderSelectionRequestId(): string {
  return `readerselreq_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

function createSourceReferenceRequestId(): string {
  return `noteref_${window.crypto.randomUUID().replaceAll("-", "").toLowerCase()}`;
}

type SourceReferenceState = {
  readonly sourceId: string;
  readonly status: "resolving" | "not_found" | "stale" | "failed";
};

export function NoteReader(props: {
  readonly note: NoteRenderResult;
  readonly activeVaultId?: string;
  readonly onResolveSelection?: (request: ReaderSelectionResolveRequest) => Promise<ReaderSelectionResolveResult>;
  readonly onSubmitSelectionAction?: (request: ReaderSelectionActionRequest) => Promise<ReaderSelectionActionResult>;
  readonly onSubmitSelectionLink?: (request: ReaderSelectionLinkRequest) => Promise<ReaderSelectionLinkResult>;
  readonly onSelectionLinkApplied?: (
    result: Extract<ReaderSelectionLinkResult, { status: "applied" }>
  ) => Promise<boolean>;
  readonly onSubmitSelectionCreateNote?: (
    request: ReaderSelectionCreateNoteRequest
  ) => Promise<ReaderSelectionCreateNoteResult>;
  readonly onSelectionCreateNoteResult?: (result: ReaderSelectionCreateNoteResult) => void;
  readonly onSubmitSelectionTransform?: (request: ReaderSelectionTransformRequest) => Promise<ReaderSelectionTransformResult>;
  readonly locale?: Locale;
  readonly onSelectionActionResult?: (result: ReaderSelectionActionResult) => void;
  readonly onSelectionTransformResult?: (result: ReaderSelectionTransformResult) => void;
  readonly related: NoteRelatedState;
  readonly relatedLoadingPageId: string | null;
  readonly onOpenRelated: (pageId: string) => Promise<void>;
  readonly onRelatedChanged?: (render: NoteRenderResult) => void;
  readonly onOpenSourceReference?: (
    request: NoteOpenSourceReferenceRequest
  ) => Promise<NoteOpenSourceReferenceResult>;
  readonly onOpenSourcePage?: (pageId: string) => Promise<void>;
  readonly onRevealSource?: Parameters<typeof ReaderSourceRevealAction>[0]["onRevealSource"];
  readonly onReconnectOriginalSource?: (
    request: NoteReconnectOriginalSourceRequest
  ) => Promise<NoteReconnectOriginalSourceResult>;
  readonly onSourceReconnected?: (render: NoteRenderResult) => void;
  readonly onActivateInlineReference?: (href: string) => Promise<ReaderInlineReferenceActivation>;
  readonly onDevelopment: (capability: "selection_actions" | "reader_link") => void;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const summary = props.note.summary;
  const readerRef = useRef<HTMLElement | null>(null);
  const markdownBodyRef = useRef<HTMLDivElement | null>(null);
  const selectionToolbarRef = useRef<HTMLDivElement | null>(null);
  const selectionActionRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectionMoreActionRefs = useRef(new Map<number, HTMLButtonElement>());
  const selectionFocusTransition = useRef(false);
  const selectionMoreOpenRef = useRef(false);
  const selectionFocusOwnerRef = useRef<HTMLElement | null>(null);
  const selectionTextRef = useRef("");
  const selectionResolveSequence = useRef(0);
  const selectionLinkInFlightRef = useRef(false);
  const selectionCreateNoteInFlightRef = useRef(false);
  const sourceReferenceSequence = useRef(0);
  const sourceReferenceInFlightRef = useRef<string | null>(null);
  const [sourceReferenceState, setSourceReferenceState] = useState<SourceReferenceState | null>(null);
  const currentSelectionRef = useRef<{
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  } | null>(null);
  const dismissedSelectionRef = useRef<typeof currentSelectionRef.current>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<{
    readonly left: number;
    readonly top: number;
    readonly bottom: number;
    readonly width: number;
  } | null>(null);
  const [selectionPosition, setSelectionPosition] = useState<{ readonly left: number; readonly top: number } | null>(null);
  const [selectionActionIndex, setSelectionActionIndex] = useState(0);
  const [selectionMoreOpen, setSelectionMoreOpen] = useState(false); const [selectionCreateOpen, setSelectionCreateOpen] = useState(false);
  const [selectionMoreActionIndex, setSelectionMoreActionIndex] = useState(0);
  const [selectionMorePlacement, setSelectionMorePlacement] = useState<"above" | "below">("below");
  const [selectionFeedback, setSelectionFeedback] = useState<string | null>(null);
  const [selectionActionPending, setSelectionActionPending] = useState(false);
  const selectionAsk = useReaderSelectionAskState(selectionFocusTransition, () =>
    selectionToolbarRef.current?.querySelector<HTMLButtonElement>('[data-selection-action="more"]')?.focus({ preventScroll: true }));
  const [selectionResolution, setSelectionResolution] = useState<
    | { readonly kind: "copy_only" }
    | { readonly kind: "checking" }
    | { readonly kind: "resolved"; readonly selection: ReaderSelectionIdentity }
  >({ kind: "copy_only" });

  useEffect(() => {
    sourceReferenceSequence.current += 1;
    sourceReferenceInFlightRef.current = null;
    selectionLinkInFlightRef.current = false;
    selectionAsk.clear();
    setSourceReferenceState(null);
    setSelectionActionPending(false);
  }, [props.activeVaultId, props.note.renderContextId, summary.pageId]);

  const openSourceReference = async (sourceId: string): Promise<void> => {
    if (sourceReferenceInFlightRef.current) return;
    const activeVaultId = props.activeVaultId;
    const renderContextId = props.note.renderContextId;
    const resolveSource = props.onOpenSourceReference;
    const openPage = props.onOpenSourcePage;
    if (!activeVaultId || !renderContextId || !resolveSource || !openPage) {
      setSourceReferenceState({ sourceId, status: "failed" });
      return;
    }
    const sequence = ++sourceReferenceSequence.current;
    sourceReferenceInFlightRef.current = sourceId;
    const request: NoteOpenSourceReferenceRequest = {
      apiVersion: 1,
      requestId: createSourceReferenceRequestId(),
      activeVaultId,
      currentPageId: summary.pageId,
      renderContextId,
      sourceId
    };
    setSourceReferenceState({ sourceId, status: "resolving" });
    try {
      const result = await resolveSource(request);
      if (sequence !== sourceReferenceSequence.current) return;
      if (result.requestId !== request.requestId) {
        sourceReferenceInFlightRef.current = null;
        setSourceReferenceState({ sourceId, status: "failed" });
        return;
      }
      if (
        props.activeVaultId !== activeVaultId ||
        props.note.renderContextId !== renderContextId ||
        props.note.summary.pageId !== summary.pageId
      ) return;
      if (result.status === "resolved") {
        await openPage(result.target.pageId);
        if (
          sequence === sourceReferenceSequence.current &&
          props.activeVaultId === activeVaultId &&
          props.note.renderContextId === renderContextId &&
          props.note.summary.pageId === summary.pageId
        ) {
          sourceReferenceInFlightRef.current = null;
          setSourceReferenceState(null);
        }
        return;
      }
      sourceReferenceInFlightRef.current = null;
      setSourceReferenceState({
        sourceId,
        status: result.status === "not_found"
          ? "not_found"
          : result.status === "stale" || result.status === "changed"
            ? "stale"
            : "failed"
      });
    } catch {
      if (sequence === sourceReferenceSequence.current) {
        sourceReferenceInFlightRef.current = null;
        setSourceReferenceState({ sourceId, status: "failed" });
      }
    }
  };

  useLayoutEffect(() => {
    const firstBlock = markdownBodyRef.current?.firstElementChild;
    if (!firstBlock || firstBlock.tagName !== "H1") return;
    const normalizeTitle = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim();
    firstBlock.classList.toggle(
      "reader-duplicate-title",
      normalizeTitle(firstBlock.textContent ?? "") === normalizeTitle(summary.title)
    );
  });

  const closeSelectionToolbar = (restoreFocus: boolean): void => {
    selectionFocusTransition.current = false;
    selectionMoreOpenRef.current = false;
    dismissedSelectionRef.current = currentSelectionRef.current;
    setSelectionMoreOpen(false); setSelectionCreateOpen(false);
    setSelectionAnchor(null);
    setSelectionPosition(null);
    if (!restoreFocus) return;
    const priorOwner = selectionFocusOwnerRef.current;
    const focusTarget = priorOwner?.isConnected ? priorOwner : readerRef.current;
    window.requestAnimationFrame(() => focusTarget?.focus({ preventScroll: true }));
  };

  useEffect(() => {
    let selectionFrame: number | null = null;
    const updateSelection = (): void => {
      if (selectionFocusTransition.current || selectionMoreOpenRef.current) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        selectionResolveSequence.current += 1;
        currentSelectionRef.current = null;
        selectionTextRef.current = "";
        dismissedSelectionRef.current = null;
        if (selectionToolbarRef.current?.contains(document.activeElement)) return;
        setSelectionAnchor(null);
        setSelectionPosition(null);
        setSelectionResolution({ kind: "copy_only" });
        return;
      }
      const range = selection.getRangeAt(0);
      const selectionNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer as Element
        : range.commonAncestorContainer.parentElement;
      if (!selectionNode || !readerRef.current?.contains(selectionNode) || typeof range.getBoundingClientRect !== "function") {
        setSelectionPosition(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      if (!Number.isFinite(rect.left) || !Number.isFinite(rect.top) || rect.width <= 0) {
        setSelectionAnchor(null);
        setSelectionPosition(null);
        return;
      }
      const nextSelectionText = selection.toString();
      const previousSelection = currentSelectionRef.current;
      const selectionChanged = !previousSelection ||
        previousSelection.left !== rect.left ||
        previousSelection.top !== rect.top ||
        previousSelection.right !== rect.right ||
        previousSelection.bottom !== rect.bottom ||
        selectionTextRef.current !== nextSelectionText;
      const nextSelection = {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom
      };
      currentSelectionRef.current = nextSelection;
      selectionTextRef.current = nextSelectionText;
      const dismissed = dismissedSelectionRef.current;
      if (dismissed
        && dismissed.left === nextSelection.left
        && dismissed.top === nextSelection.top
        && dismissed.right === nextSelection.right
        && dismissed.bottom === nextSelection.bottom) return;
      dismissedSelectionRef.current = null;
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && !selectionToolbarRef.current?.contains(activeElement)) {
        selectionFocusOwnerRef.current = activeElement === document.body ? readerRef.current : activeElement;
      }
      const anchor = {
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width
      };
      setSelectionAnchor(anchor);
      setSelectionActionIndex(0);
      if (selectionChanged) {
        selectionMoreOpenRef.current = false;
        setSelectionMoreOpen(false);
        selectionAsk.clear();
        setSelectionFeedback(null);
      }
      setSelectionPosition({ left: Math.max(12, anchor.left), top: Math.max(12, anchor.top) });
      if (!selectionChanged) return;

      const resolveSequence = ++selectionResolveSequence.current;
      const renderContextId = props.note.renderContextId;
      const activeVaultId = props.activeVaultId;
      const resolveSelection = props.onResolveSelection;
      const reader = readerRef.current;
      const anchorEndpoint = readerSelectionEndpoint(reader, selection.anchorNode, selection.anchorOffset);
      const focusEndpoint = readerSelectionEndpoint(reader, selection.focusNode, selection.focusOffset);
      if (!renderContextId || !activeVaultId || !resolveSelection || !anchorEndpoint || !focusEndpoint) {
        setSelectionResolution({ kind: "copy_only" });
        return;
      }
      setSelectionResolution({ kind: "checking" });
      const request: ReaderSelectionResolveRequest = {
        apiVersion: 1,
        requestId: createReaderSelectionRequestId(),
        activeVaultId,
        currentPageId: summary.pageId,
        renderContextId,
        anchor: anchorEndpoint,
        focus: focusEndpoint
      };
      void resolveSelection(request).then((result) => {
        if (resolveSequence !== selectionResolveSequence.current || result.requestId !== request.requestId) return;
        if (props.note.renderContextId !== renderContextId || props.activeVaultId !== activeVaultId) return;
        setSelectionResolution(result.status === "resolved"
          ? { kind: "resolved", selection: result.selection }
          : { kind: "copy_only" });
      }).catch(() => {
        if (resolveSequence === selectionResolveSequence.current) setSelectionResolution({ kind: "copy_only" });
      });
    };
    const scheduleSelectionUpdate = (): void => {
      if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
      selectionFrame = window.requestAnimationFrame(() => {
        selectionFrame = null;
        updateSelection();
      });
    };
    const dismissOnScroll = (event: Event): void => {
      if (event.target instanceof Node && selectionToolbarRef.current?.contains(event.target)) return;
      selectionMoreOpenRef.current = false;
      dismissedSelectionRef.current = currentSelectionRef.current;
      setSelectionMoreOpen(false);
      setSelectionAnchor(null);
      setSelectionPosition(null);
    };
    const dismissMenuOutside = (event: PointerEvent): void => {
      if (!selectionMoreOpenRef.current) return;
      if (event.target instanceof Node && selectionToolbarRef.current?.contains(event.target)) return;
      closeSelectionToolbar(false);
    };
    document.addEventListener("selectionchange", updateSelection);
    document.addEventListener("pointerdown", dismissMenuOutside, true);
    window.addEventListener("resize", scheduleSelectionUpdate);
    window.addEventListener("scroll", dismissOnScroll, true);
    const reader = readerRef.current;
    const readerResizeObserver = reader && typeof window.ResizeObserver === "function"
      ? new window.ResizeObserver(scheduleSelectionUpdate)
      : null;
    if (reader) readerResizeObserver?.observe(reader);
    return () => {
      selectionResolveSequence.current += 1;
      if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
      document.removeEventListener("selectionchange", updateSelection);
      document.removeEventListener("pointerdown", dismissMenuOutside, true);
      window.removeEventListener("resize", scheduleSelectionUpdate);
      window.removeEventListener("scroll", dismissOnScroll, true);
      readerResizeObserver?.disconnect();
    };
  }, [props.activeVaultId, props.note.renderContextId, props.onResolveSelection, summary.pageId]);

  useEffect(() => {
    if (!selectionAnchor) return;
    const ownerWindow = readerRef.current?.ownerDocument.defaultView;
    if (!ownerWindow) return;
    let frame: number | null = null;
    const positionToolbar = (): void => {
      frame = null;
      const toolbar = selectionToolbarRef.current;
      if (!toolbar) return;
      const toolbarRect = toolbar.getBoundingClientRect();
      const width = Math.max(toolbarRect.width, toolbar.offsetWidth, toolbar.scrollWidth);
      const height = Math.max(toolbarRect.height, toolbar.offsetHeight, toolbar.scrollHeight);
      if (width <= 0 || height <= 0) return;
      const maxLeft = Math.max(12, ownerWindow.innerWidth - width - 12);
      const maxTop = Math.max(12, ownerWindow.innerHeight - height - 12);
      const preferredLeft = selectionAnchor.left + (selectionAnchor.width / 2) - (width / 2);
      const above = selectionAnchor.top - height - 8;
      const preferredTop = above >= 12 ? above : selectionAnchor.bottom + 8;
      const next = {
        left: Math.max(12, Math.min(maxLeft, preferredLeft)),
        top: Math.max(12, Math.min(maxTop, preferredTop))
      };
      setSelectionPosition((current) => current?.left === next.left && current.top === next.top ? current : next);
    };
    const schedulePosition = (): void => {
      if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
      frame = ownerWindow.requestAnimationFrame(positionToolbar);
    };
    schedulePosition();
    const toolbar = selectionToolbarRef.current;
    const resizeObserver = toolbar && typeof ownerWindow.ResizeObserver === "function"
      ? new ownerWindow.ResizeObserver(schedulePosition)
      : null;
    if (toolbar) resizeObserver?.observe(toolbar);
    return () => {
      if (frame !== null) ownerWindow.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
    };
  }, [selectionAnchor]);

  useLayoutEffect(() => {
    if (!selectionMoreOpen) return;
    const menu = selectionToolbarRef.current?.querySelector<HTMLElement>(".selection-more-menu");
    const toolbar = selectionToolbarRef.current;
    if (!menu || !toolbar) return;
    const toolbarRect = toolbar.getBoundingClientRect();
    const menuHeight = Math.max(menu.getBoundingClientRect().height, menu.offsetHeight, menu.scrollHeight);
    const ownerWindow = toolbar.ownerDocument.defaultView;
    if (!ownerWindow) return;
    setSelectionMorePlacement(toolbarRect.bottom + menuHeight + 6 <= ownerWindow.innerHeight - 12 ? "below" : "above");
  }, [selectionMoreOpen, selectionPosition]);

  const moveSelectionActionFocus = (index: number): void => {
    selectionFocusTransition.current = true;
    setSelectionActionIndex(index);
    window.requestAnimationFrame(() => {
      selectionActionRefs.current.get(index)?.focus();
      window.requestAnimationFrame(() => { selectionFocusTransition.current = false; });
    });
  };

  const moveSelectionMoreActionFocus = (index: number): void => {
    setSelectionMoreActionIndex(index);
    readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
      selectionMoreActionRefs.current.get(index)?.focus({ preventScroll: true });
    });
  };

  const toggleSelectionMore = (): void => {
    const next = !selectionMoreOpen;
    selectionMoreOpenRef.current = next;
    if (next) selectionFocusTransition.current = true;
    setSelectionMoreOpen(next);
    if (next) {
      setSelectionMoreActionIndex(0);
      readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
        selectionMoreActionRefs.current.get(0)?.focus({ preventScroll: true });
        readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => {
          selectionFocusTransition.current = false;
        });
      });
    } else {
      selectionFocusTransition.current = false;
    }
  };

  const copySelection = async (asQuote: boolean): Promise<void> => {
    const selectedText = selectionTextRef.current;
    const clipboard = readerRef.current?.ownerDocument.defaultView?.navigator.clipboard;
    if (!selectedText || !clipboard?.writeText) {
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.copyFailed"));
      return;
    }
    const clipboardText = asQuote
      ? selectedText.split(/\r?\n/u).map((line) => `> ${line}`).join("\n")
      : selectedText;
    try {
      await clipboard.writeText(clipboardText);
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t(asQuote ? "note.selection.quoteCopied" : "note.selection.copied"));
    } catch {
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.copyFailed"));
    }
  };

  const submitSelectionAction = async (
    action: "explain" | "summarize",
    selection: ReaderSelectionIdentity
  ): Promise<void> => {
    if (selectionActionPending) return;
    const resolveSequence = selectionResolveSequence.current;
    setSelectionActionPending(true);
    setSelectionFeedback(null);
    try {
      if (!props.onSubmitSelectionAction) throw new Error("Reader selection actions are unavailable.");
      const result = await props.onSubmitSelectionAction({
        apiVersion: 1,
        requestId: createReaderSelectionActionRequestId(),
        action,
        selection,
        locale: props.locale ?? "en",
        clientTurnId: createReaderSelectionAgentTurnId()
      });
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      props.onSelectionActionResult?.(result);
      setSelectionFeedback(props.t(
        result.status === "completed" || result.status === "waiting"
          ? "note.selection.sentToAgent"
          : "note.selection.actionFailed"
      ));
    } catch {
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.actionFailed"));
    } finally {
      if (resolveSequence === selectionResolveSequence.current) setSelectionActionPending(false);
    }
  };

  const submitSelectionLink = async (selection: ReaderSelectionIdentity): Promise<void> => {
    if (selectionActionPending || selectionLinkInFlightRef.current) return;
    const resolveSequence = selectionResolveSequence.current;
    const activeVaultId = props.activeVaultId;
    const renderContextId = props.note.renderContextId;
    const submitLink = props.onSubmitSelectionLink;
    if (!activeVaultId || !renderContextId || !submitLink) return;
    const request: ReaderSelectionLinkRequest = {
      apiVersion: 1,
      requestId: createReaderSelectionActionRequestId(),
      action: "link",
      activeVaultId,
      renderContextId,
      selection,
      locale: props.locale ?? "en",
      clientTurnId: createReaderSelectionAgentTurnId()
    };
    selectionLinkInFlightRef.current = true;
    setSelectionActionPending(true);
    setSelectionFeedback(null);
    try {
      const result = await submitLink(request);
      if (
        resolveSequence !== selectionResolveSequence.current ||
        result.requestId !== request.requestId ||
        props.activeVaultId !== activeVaultId ||
        props.note.renderContextId !== renderContextId ||
        props.note.summary.pageId !== selection.pageId
      ) return;
      if (result.status !== "applied" || result.currentPageId !== selection.pageId) {
        setSelectionFeedback(props.t("note.selection.actionFailed"));
        return;
      }
      closeSelectionToolbar(true);
      const refreshed = props.onSelectionLinkApplied ? await props.onSelectionLinkApplied(result) : false;
      setSelectionFeedback(props.t(refreshed === false ? "note.selection.actionFailed" : "note.selection.applied"));
    } catch {
      if (resolveSequence === selectionResolveSequence.current) {
        setSelectionFeedback(props.t("note.selection.actionFailed"));
      }
    } finally {
      if (resolveSequence === selectionResolveSequence.current) {
        selectionLinkInFlightRef.current = false;
        setSelectionActionPending(false);
      }
    }
  };

  const submitSelectionCreateNote = async (selection: ReaderSelectionIdentity, action: ReaderSelectionCreatePageAction): Promise<void> => {
    if (selectionActionPending || selectionCreateNoteInFlightRef.current) return;
    const resolveSequence = selectionResolveSequence.current;
    const activeVaultId = props.activeVaultId;
    const renderContextId = props.note.renderContextId;
    const submitCreateNote = props.onSubmitSelectionCreateNote;
    if (!activeVaultId || !renderContextId || !submitCreateNote) return;
    const request: ReaderSelectionCreateNoteRequest = {
      apiVersion: 1,
      requestId: createReaderSelectionActionRequestId(),
      action,
      activeVaultId,
      renderContextId,
      selection,
      locale: props.locale ?? "en",
      clientTurnId: createReaderSelectionAgentTurnId()
    };
    selectionCreateNoteInFlightRef.current = true;
    setSelectionActionPending(true);
    setSelectionFeedback(null);
    try {
      const result = await submitCreateNote(request);
      if (
        resolveSequence !== selectionResolveSequence.current ||
        result.requestId !== request.requestId ||
        props.activeVaultId !== activeVaultId ||
        props.note.renderContextId !== renderContextId ||
        props.note.summary.pageId !== selection.pageId
      ) return;
      props.onSelectionCreateNoteResult?.(result);
      setSelectionFeedback(props.t(
        result.status === "review_required"
          ? "note.selection.reviewReady"
          : result.status === "waiting"
            ? "note.selection.sentToAgent"
            : "note.selection.actionFailed"
      ));
    } catch {
      if (resolveSequence === selectionResolveSequence.current) {
        setSelectionFeedback(props.t("note.selection.actionFailed"));
      }
    } finally {
      if (resolveSequence === selectionResolveSequence.current) {
        selectionCreateNoteInFlightRef.current = false;
        setSelectionActionPending(false);
      }
    }
  };

  const submitSelectionTransform = async (
    action: "translate" | "polish" | "expand",
    selection: ReaderSelectionIdentity
  ): Promise<void> => {
    if (selectionActionPending) return;
    const resolveSequence = selectionResolveSequence.current;
    setSelectionActionPending(true);
    setSelectionFeedback(null);
    try {
      if (!props.onSubmitSelectionTransform) throw new Error("Reader selection transforms are unavailable.");
      const result = await props.onSubmitSelectionTransform({
        apiVersion: 1,
        requestId: createReaderSelectionActionRequestId(),
        action,
        selection,
        locale: props.locale ?? "en",
        clientTurnId: createReaderSelectionAgentTurnId()
      });
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      props.onSelectionTransformResult?.(result);
      setSelectionFeedback(props.t(
        result.status === "applied"
          ? "note.selection.applied"
          : result.status === "review_required"
            ? "note.selection.reviewReady"
            : result.status === "waiting"
              ? "note.selection.sentToAgent"
              : "note.selection.actionFailed"
      ));
    } catch {
      if (resolveSequence !== selectionResolveSequence.current) return;
      closeSelectionToolbar(true);
      setSelectionFeedback(props.t("note.selection.actionFailed"));
    } finally {
      if (resolveSequence === selectionResolveSequence.current) setSelectionActionPending(false);
    }
  };

  const selectionActions = selectionResolution.kind === "resolved"
    ? (["explain", "summarize", "link", "more"] as const)
    : (["copy", "copyAsQuote"] as const);
  const selectionMoreActions = ["ask", "createNote", "copy", "copyAsQuote", "translate", "polish", "expand"] as const;
  return (
    <article className="note-reader" ref={readerRef} tabIndex={-1}>
      {selectionAnchor && selectionPosition ? <>
        <ReaderSelectionAskDialog
          identityKey={selectionAsk.current ? `${selectionAsk.current.selection.pageId}:${selectionAsk.current.selection.pageContentHash}:${selectionAsk.current.selection.selectedContentHash}:${selectionAsk.current.selection.span.start}:${selectionAsk.current.selection.span.endExclusive}` : "reader-selection-ask-closed"}
          open={selectionAsk.current?.open === true}
          selection={selectionAsk.current?.selection ?? null}
          locale={props.locale ?? "en"}
          position={{ left: selectionPosition.left, top: selectionPosition.top }}
          onSubmitAction={props.onSubmitSelectionAction ?? (() => Promise.reject(new Error("Reader selection actions are unavailable.")))}
          onActionResult={(result) => props.onSelectionActionResult?.(result)}
          onSent={selectionAsk.clear}
          onCancel={selectionAsk.close}
          t={props.t}
        />
        {selectionAsk.current?.open !== true ? (
        <div
          ref={selectionToolbarRef}
          className="selection-toolbar visible"
          role="toolbar"
          aria-label={props.t("note.selectionActions")}
          style={{ left: selectionPosition.left, top: selectionPosition.top }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeSelectionToolbar(true);
              return;
            }
            let nextIndex: number | null = null;
            if (event.key === "ArrowRight") nextIndex = (selectionActionIndex + 1) % selectionActions.length;
            else if (event.key === "ArrowLeft") nextIndex = (selectionActionIndex - 1 + selectionActions.length) % selectionActions.length;
            else if (event.key === "Home") nextIndex = 0;
            else if (event.key === "End") nextIndex = selectionActions.length - 1;
            if (nextIndex === null) return;
            event.preventDefault();
            moveSelectionActionFocus(nextIndex);
          }}
        >
          {selectionActions.map((action, index) => (
            <button
              key={action}
              ref={(element) => {
                if (element) selectionActionRefs.current.set(index, element);
                else selectionActionRefs.current.delete(index);
              }}
              type="button"
              disabled={selectionActionPending}
              tabIndex={selectionActionIndex === index ? 0 : -1}
              data-selection-action={action}
              aria-expanded={action === "more" ? selectionMoreOpen : undefined}
              aria-controls={action === "more" ? "reader-selection-more-menu" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                if (action === "copy" || action === "copyAsQuote") {
                  void copySelection(action === "copyAsQuote");
                  return;
                }
                if (action === "more") {
                  toggleSelectionMore();
                  return;
                }
                if ((action === "explain" || action === "summarize") && selectionResolution.kind === "resolved") {
                  void submitSelectionAction(action, selectionResolution.selection);
                  return;
                }
                if (action === "link" && selectionResolution.kind === "resolved") {
                  if (props.onSubmitSelectionLink && props.onSelectionLinkApplied) {
                    void submitSelectionLink(selectionResolution.selection);
                  } else {
                    closeSelectionToolbar(true);
                    props.onDevelopment("reader_link");
                  }
                  return;
                }
                closeSelectionToolbar(true);
                props.onDevelopment("selection_actions");
              }}
            >
              {props.t(`note.selection.${action}`)}
            </button>
          ))}
          {selectionMoreOpen ? (
            <div
              id="reader-selection-more-menu"
              className={`selection-more-menu ${selectionMorePlacement}`}
              role="menu"
              aria-label={props.t("note.selection.moreActions")}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  selectionMoreOpenRef.current = false;
                  setSelectionMoreOpen(false);
                  readerRef.current?.ownerDocument.defaultView?.requestAnimationFrame(() => selectionActionRefs.current.get(selectionActions.length - 1)?.focus());
                  return;
                }
                let nextIndex: number | null = null;
                if (event.key === "ArrowDown") nextIndex = (selectionMoreActionIndex + 1) % selectionMoreActions.length;
                else if (event.key === "ArrowUp") nextIndex = (selectionMoreActionIndex - 1 + selectionMoreActions.length) % selectionMoreActions.length;
                else if (event.key === "Home") nextIndex = 0;
                else if (event.key === "End") nextIndex = selectionMoreActions.length - 1;
                if (nextIndex === null) return;
                event.preventDefault();
                moveSelectionMoreActionFocus(nextIndex);
              }}
            >
              {selectionMoreActions.map((action, index) => (
                <button
                  key={action}
                  ref={(element) => {
                    if (element) selectionMoreActionRefs.current.set(index, element);
                    else selectionMoreActionRefs.current.delete(index);
                  }}
                  type="button"
                  role="menuitem"
                  tabIndex={selectionMoreActionIndex === index ? 0 : -1}
                  data-selection-more-action={action}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (action === "ask") {
                      if (selectionResolution.kind === "resolved" && props.onSubmitSelectionAction) {
                        selectionMoreOpenRef.current = false;
                        setSelectionMoreOpen(false);
                        selectionAsk.open(selectionResolution.selection);
                      } else {
                        closeSelectionToolbar(true);
                        props.onDevelopment("selection_actions");
                      }
                      return;
                    }
                    if (action === "createNote") {
                      if (selectionResolution.kind === "resolved" && props.onSubmitSelectionCreateNote) {
                        selectionMoreOpenRef.current = false; setSelectionMoreOpen(false); setSelectionCreateOpen(true);
                      } else {
                        closeSelectionToolbar(true);
                        props.onDevelopment("selection_actions");
                      }
                      return;
                    }
                    if (action === "copy" || action === "copyAsQuote") {
                      void copySelection(action === "copyAsQuote");
                      return;
                    }
                    if (selectionResolution.kind === "resolved" && props.onSubmitSelectionTransform) {
                      void submitSelectionTransform(action, selectionResolution.selection);
                      return;
                    }
                    closeSelectionToolbar(true);
                    props.onDevelopment("selection_actions");
                  }}
                >
                  {props.t(action === "createNote" ? "note.selection.turnInto" : `note.selection.${action}`)}
                  {((action === "translate" || action === "polish" || action === "expand") &&
                  !props.onSubmitSelectionTransform) || (action === "createNote" && !props.onSubmitSelectionCreateNote) ? (
                    <span>{props.t("note.selection.unavailable")}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
          {selectionCreateOpen && selectionResolution.kind === "resolved" ? <ReaderSelectionCreateChooser ownerIdentity={`${props.note.summary.pageId}:${props.note.renderContextId ?? ""}:${selectionResolution.selection.pageContentHash}:${selectionResolution.selection.span.start}:${selectionResolution.selection.span.endExclusive}:${selectionResolution.selection.selectedContentHash}`} t={props.t} onCancel={() => { setSelectionCreateOpen(false); window.requestAnimationFrame(() => selectionActionRefs.current.get(selectionActions.length - 1)?.focus({ preventScroll: true })); }} onChoose={(action) => { setSelectionCreateOpen(false); window.requestAnimationFrame(() => selectionActionRefs.current.get(selectionActions.length - 1)?.focus({ preventScroll: true })); void submitSelectionCreateNote(selectionResolution.selection, action); }} /> : null}
        </div>) : null}
      </> : null}
      {selectionFeedback ? (
        <p className="reader-selection-feedback" role="status" aria-live="polite" aria-atomic="true">
          {selectionFeedback}
        </p>
      ) : null}
      <header className="note-header">
        <h1>{summary.title}</h1>
        <div className="note-meta" aria-label={props.t("note.metadata")}>
          <span>{summary.status}</span>
          {summary.language ? <span>{summary.language}</span> : null}
          <span>
            {props.t("note.size")}: {Math.ceil(props.note.byteSize / 1024)} KB
          </span>
          {summary.sourceIds.length > 0 ? (
            <span>
              {props.t("library.sources")}: {summary.sourceIds.length}
            </span>
          ) : null}
        </div>
      </header>
      <ReaderInlineReferenceSurface
        ref={markdownBodyRef}
        pageIdentity={`${summary.pageId}:${props.note.renderContextId ?? "unavailable"}`}
        html={props.note.html}
        onUnavailable={() => props.onDevelopment("reader_link")}
        t={props.t}
        {...(props.onActivateInlineReference ? { onActivate: props.onActivateInlineReference } : {})}
      />
      {summary.sourceIds.length > 0 ? (
        <section className="reader-sources" aria-label={props.t("note.sources")}>
          <h2>{props.t("note.sources")}</h2>
          <div className="reader-source-list">
            {summary.sourceIds.slice(0, 5).map((sourceId, index) => {
              const sourceLabel = props.t("note.savedSource").replace("{number}", String(index + 1));
              return (
                <div key={sourceId}>
                  <button
                    className="reader-source"
                    type="button"
                    data-reader-source-action="open"
                    data-reader-source-open={sourceId}
                    disabled={sourceReferenceState?.status === "resolving"}
                    aria-busy={sourceReferenceState?.sourceId === sourceId && sourceReferenceState.status === "resolving"}
                    onClick={() => void openSourceReference(sourceId)}
                  >
                    <span className="reader-source-icon" aria-hidden="true">SRC</span>
                    <span className="reader-source-copy">
                      <strong>{sourceLabel}</strong>
                      <span
                        role={sourceReferenceState?.sourceId === sourceId ? "status" : undefined}
                        aria-live={sourceReferenceState?.sourceId === sourceId ? "polite" : undefined}
                        aria-atomic={sourceReferenceState?.sourceId === sourceId ? "true" : undefined}
                      >
                        {props.t(sourceReferenceState?.sourceId === sourceId
                          ? `note.readerLink.${sourceReferenceState.status}`
                          : "note.readerLinkReady")}
                      </span>
                    </span>
                    <small>{props.t("note.open")}</small>
                  </button>
                </div>
              );
            })}
            <NoteReaderSourceActions
              currentPageId={summary.pageId}
              sourceIds={summary.sourceIds}
              labels={readerSourceActionLabels(props.t)}
              sourceLabel={(number) => props.t("note.savedSource").replace("{number}", String(number))} t={props.t}
              getFocusRoot={() => readerRef.current}
              {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
              {...(props.note.renderContextId ? { renderContextId: props.note.renderContextId } : {})}
              {...(props.note.reconnectOriginalSourceIds ? { reconnectOriginalSourceIds: props.note.reconnectOriginalSourceIds } : {})} {...(props.note.reconnectOriginalSources ? { reconnectOriginalSources: props.note.reconnectOriginalSources } : {})}
              {...(props.onRevealSource ? { onRevealSource: props.onRevealSource } : {})}
              {...(props.onReconnectOriginalSource ? { onReconnectOriginalSource: props.onReconnectOriginalSource } : {})}
              {...(props.onSourceReconnected ? { onSourceReconnected: props.onSourceReconnected } : {})}
            />
          </div>
          {summary.sourceIds.length > 5 ? (
            <p className="reader-source-overflow">
              {props.t("note.moreSources").replace("{count}", String(summary.sourceIds.length - 5))}
            </p>
          ) : null}
        </section>
      ) : null}
      <NoteRelatedPanel
        note={props.note}
        {...(props.activeVaultId ? { activeVaultId: props.activeVaultId } : {})}
        related={props.related}
        loadingPageId={props.relatedLoadingPageId}
        onOpen={props.onOpenRelated}
        {...(props.onRelatedChanged ? { onCommitted: props.onRelatedChanged } : {})}
        t={props.t}
      />
    </article>
  );
}
