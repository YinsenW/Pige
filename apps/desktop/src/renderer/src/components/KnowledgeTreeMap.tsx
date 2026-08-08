import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent
} from "react";
import type { KnowledgeTreeNode, KnowledgeTreePageRef, LibraryRelatedResult } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";
import {
  KnowledgeTreeBranchPanel,
  KnowledgeTreeRelatedPanel,
  type KnowledgeTreeRelatedState
} from "./KnowledgeTreeInspectorPanels";
import { KnowledgeTreeSearchControl } from "./KnowledgeTreeSearchResults";
import {
  normalizeKnowledgeTreeQuery,
  searchKnowledgeTree,
  type KnowledgeTreeSearchMatch
} from "./knowledge-tree-search-model";
import { evidenceDensity, evidenceDensityBand, formatNodeSummary, searchKindLabel } from "./KnowledgeTreeMapSemantics";
type TreeMode = "tree" | "network" | "list";
type VisualNode = {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly kind: KnowledgeTreeNode["kind"] | "page" | "root";
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly weight: number;
  readonly fragmentCount: number;
  readonly sourceCount: number;
  readonly leafCount: number;
  readonly status: KnowledgeTreeNode["status"] | KnowledgeTreePageRef["status"] | "active";
  readonly siblingIndex: number;
  readonly siblingCount: number;
  readonly childCount: number;
  readonly pageId?: string;
  readonly focusKey?: string;
};
type VisualTree = {
  readonly nodes: readonly VisualNode[];
  readonly byId: ReadonlyMap<string, VisualNode>;
  readonly maxWeight: number;
  readonly maxDensity: number;
  readonly layoutWidth: number;
  readonly fitZoom: number;
  readonly fitPan: { readonly x: number; readonly y: number };
};
type LayoutNode = Omit<VisualNode, "x" | "y" | "childCount"> & {
  readonly children: readonly LayoutNode[];
};
type ViewportAnnouncement =
  | { readonly kind: "focused"; readonly title: string }
  | { readonly kind: "zoom"; readonly percent: number };
type PointerDrag = {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly panX: number;
  readonly panY: number;
};
export function KnowledgeTreeMap(props: {
  readonly roots: readonly KnowledgeTreeNode[];
  readonly activeVaultId: string;
  readonly treeOwnerKey: string;
  readonly noteLoadingPageId: string | null;
  readonly onLoadRelated: (pageId: string) => Promise<LibraryRelatedResult>;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const visual = useMemo(() => buildVisualTree(props.roots, props.t), [props.roots, props.t]);
  const [mode, setMode] = useState<TreeMode>("tree");
  const [announcedMode, setAnnouncedMode] = useState<TreeMode | null>(null);
  const [query, setQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [activeId, setActiveId] = useState(() => visual.nodes[1]?.id ?? visual.nodes[0]?.id ?? "pige-root");
  const [zoom, setZoom] = useState(() => visual.fitZoom);
  const [pan, setPan] = useState(() => visual.fitPan);
  const [dragging, setDragging] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewportAnnouncement, setViewportAnnouncement] = useState<ViewportAnnouncement | null>(null);
  const [related, setRelated] = useState<{ readonly owner: string; readonly value: KnowledgeTreeRelatedState }>({
    owner: "",
    value: null
  });
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const searchOriginRef = useRef<string | null>(null);
  const searchCollapseOriginRef = useRef<ReadonlySet<string> | null>(null);
  const searchOwnerRef = useRef<string | null>(null);
  const activeIdRef = useRef(activeId);
  const treeOwnerRef = useRef(props.treeOwnerKey);
  const relatedSequenceRef = useRef(0);
  const relatedOwnerRef = useRef("");
  const onLoadRelatedRef = useRef(props.onLoadRelated);
  const active = visual.byId.get(activeId) ?? visual.nodes[0];
  const normalizedQuery = normalizeKnowledgeTreeQuery(query);
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  onLoadRelatedRef.current = props.onLoadRelated;
  activeIdRef.current = activeId;
  treeOwnerRef.current = props.treeOwnerKey;
  relatedOwnerRef.current = `${props.activeVaultId}:${active?.id ?? ""}:${active?.pageId ?? ""}`;

  useEffect(() => {
    const pageId = active?.pageId;
    const owner = `${props.activeVaultId}:${active?.id ?? ""}:${pageId ?? ""}`;
    const sequence = relatedSequenceRef.current + 1;
    relatedSequenceRef.current = sequence;
    if (!pageId) {
      setRelated({ owner, value: null });
      return;
    }
    setRelated({ owner, value: "loading" });
    void onLoadRelatedRef.current(pageId).then((result) => {
      if (
        sequence !== relatedSequenceRef.current ||
        relatedOwnerRef.current !== owner ||
        result.activeVaultId !== props.activeVaultId ||
        result.pageId !== pageId
      ) return;
      setRelated({ owner, value: result });
    }).catch(() => {
      if (sequence === relatedSequenceRef.current && relatedOwnerRef.current === owner) {
        setRelated({ owner, value: "unavailable" });
      }
    });
  }, [active?.id, active?.pageId, props.activeVaultId]);
  const nodeAllowedByMode = (node: VisualNode): boolean => {
    if (mode === "list" && node.level >= 3) return false;
    if (reviewOnly && node.status !== "needs_review" && node.kind !== "root") return false;
    return true;
  };
  const nodeVisibleInBranch = (node: VisualNode): boolean => {
    let parentId = node.parentId;
    while (parentId) {
      if (collapsedIds.has(parentId)) return false;
      parentId = visual.byId.get(parentId)?.parentId ?? null;
    }
    return true;
  };

  const nodeInteractive = (node: VisualNode): boolean =>
    nodeAllowedByMode(node) && nodeVisibleInBranch(node);

  const searchMatches = searchKnowledgeTree(
    visual.nodes.filter((node) => node.kind !== "root" && nodeAllowedByMode(node)).map((node) => ({
      id: node.id,
      parentId: node.parentId,
      title: node.title,
      kind: node.kind,
      kindLabel: searchKindLabel(props.t, node),
      ...(node.pageId ? { pageId: node.pageId } : {}),
      ...(node.focusKey ? { focusKey: node.focusKey } : {})
    })),
    normalizedQuery
  );
  const searchMatchIds = new Set(searchMatches.map(({ id }) => id));
  const searchAncestorKey = searchMatches.flatMap(({ ancestorIds }) => ancestorIds).join("\0");
  const nodeSearchMatch = (node: VisualNode): boolean =>
    !normalizedQuery || searchMatchIds.has(node.id);
  const nodeDimmed = (node: VisualNode): boolean => !nodeInteractive(node) || !nodeSearchMatch(node);
  const visibleNodes = visual.nodes.filter(nodeVisibleInBranch);
  const activeChildren = active && !collapsedIds.has(active.id)
    ? visual.nodes.filter((node) => node.parentId === active.id && nodeInteractive(node))
    : [];
  const setBranchCollapsed = (node: VisualNode, collapsed: boolean): void => {
    if (node.childCount === 0) return;
    setCollapsedIds((current) => {
      if (current.has(node.id) === collapsed) return current;
      const next = new Set(current);
      if (collapsed) next.add(node.id);
      else next.delete(node.id);
      return next;
    });
  };
  const revealNode = (node: VisualNode): void => {
    const ancestors = new Set<string>();
    let parentId = node.parentId;
    while (parentId) {
      ancestors.add(parentId);
      parentId = visual.byId.get(parentId)?.parentId ?? null;
    }
    if (ancestors.size === 0) return;
    setCollapsedIds((current) => {
      if (![...ancestors].some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ancestors) next.delete(id);
      return next;
    });
  };

  const cameraForNode = (node: VisualNode): { readonly zoom: number; readonly pan: { readonly x: number; readonly y: number } } => {
    if (node.kind === "root") return { zoom: visual.fitZoom, pan: visual.fitPan };
    const nextZoom = node.level <= 1 ? 1.24 : 1.5;
    return {
      zoom: nextZoom,
      pan: { x: 450 - node.x * nextZoom, y: 310 - node.y * nextZoom }
    };
  };
  useEffect(() => {
    setCollapsedIds((current) => {
      const next = new Set([...current].filter((id) => (visual.byId.get(id)?.childCount ?? 0) > 0));
      return next.size === current.size ? current : next;
    });
  }, [visual]);
  useEffect(() => {
    if (!normalizedQuery || searchOwnerRef.current !== props.treeOwnerKey) return;
    const ancestors = new Set(searchAncestorKey.split("\0").filter(Boolean));
    if (ancestors.size === 0) return;
    setCollapsedIds((current) => {
      if (![...ancestors].some((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of ancestors) next.delete(id);
      return next;
    });
  }, [normalizedQuery, props.treeOwnerKey, searchAncestorKey]);
  useEffect(() => {
    if (searchOwnerRef.current === null || searchOwnerRef.current === props.treeOwnerKey) return;
    searchOwnerRef.current = null;
    searchOriginRef.current = null;
    searchCollapseOriginRef.current = null;
    setQuery("");
    setSearchIndex(0);
  }, [props.treeOwnerKey]);
  useEffect(() => {
    if (!moreOpen) return;
    const move = (): void => moreMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(move);
    else move();
  }, [moreOpen]);
  useEffect(() => {
    const current = visual.byId.get(activeId);
    if (current && nodeInteractive(current)) return;
    const shouldRestoreTreeFocus = Boolean(current && nodeRefs.current.get(current.id) === document.activeElement);
    let replacement = current;
    while (replacement?.parentId) {
      replacement = visual.byId.get(replacement.parentId);
      if (replacement && nodeInteractive(replacement)) break;
    }
    if (!replacement || !nodeInteractive(replacement)) replacement = visual.nodes.find(nodeInteractive);
    if (!replacement || replacement.id === activeId) return;
    setActiveId(replacement.id);
    const nextCamera = cameraForNode(replacement);
    setZoom(nextCamera.zoom);
    setPan(nextCamera.pan);
    if (shouldRestoreTreeFocus) {
      const move = (): void => nodeRefs.current.get(replacement!.id)?.focus();
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(move);
      else move();
    }
  }, [activeId, mode, reviewOnly, visual]);

  const activateMode = (nextMode: TreeMode): void => {
    setMode(nextMode);
    setAnnouncedMode(nextMode);
    setViewportAnnouncement(null);
    if (nextMode === "tree") {
      setZoom(visual.fitZoom);
      setPan(visual.fitPan);
    }
    if (nextMode !== "list" || !active || active.level < 3) return;
    let visibleAncestor = active;
    while (visibleAncestor.level >= 3 && visibleAncestor.parentId) {
      visibleAncestor = visual.byId.get(visibleAncestor.parentId) ?? visual.nodes[0]!;
    }
    setActiveId(visibleAncestor.id);
    const nextCamera = cameraForNode(visibleAncestor);
    setZoom(nextCamera.zoom);
    setPan(nextCamera.pan);
  };

  const focusNode = (node: VisualNode, moveFocus = false, announce = true): void => {
    setActiveId(node.id);
    const nextCamera = cameraForNode(node);
    setZoom(nextCamera.zoom);
    setPan(nextCamera.pan);
    setAnnouncedMode(null);
    if (announce) setViewportAnnouncement({ kind: "focused", title: node.title });
    if (moveFocus) {
      const move = (): void => nodeRefs.current.get(node.id)?.focus();
      if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(move);
      else move();
    }
  };

  const changeZoom = (delta: number): void => {
    const nextZoom = Math.max(.78, Math.min(2.2, zoom + delta));
    const mapCenterX = (450 - pan.x) / zoom;
    const mapCenterY = (310 - pan.y) / zoom;
    setZoom(nextZoom);
    setPan({
      x: 450 - mapCenterX * nextZoom,
      y: 310 - mapCenterY * nextZoom
    });
    setAnnouncedMode(null);
    setViewportAnnouncement({ kind: "zoom", percent: Math.round(nextZoom * 100) });
  };

  const fitTree = (): void => {
    setZoom(visual.fitZoom);
    setPan(visual.fitPan);
    setAnnouncedMode(null);
    setViewportAnnouncement({ kind: "zoom", percent: Math.round(visual.fitZoom * 100) });
  };

  const updateQuery = (nextQuery: string): void => {
    if (!query && nextQuery) {
      searchOriginRef.current = activeId;
      searchCollapseOriginRef.current = new Set(collapsedIds);
      searchOwnerRef.current = props.treeOwnerKey;
    }
    if (query && !nextQuery) {
      const origin = searchOriginRef.current ? visual.byId.get(searchOriginRef.current) : undefined;
      const collapseOrigin = searchCollapseOriginRef.current;
      searchOriginRef.current = null;
      searchCollapseOriginRef.current = null;
      searchOwnerRef.current = null;
      if (collapseOrigin) setCollapsedIds(collapseOrigin);
      if (origin && nodeInteractive(origin)) focusNode(origin, false, false);
    }
    setAnnouncedMode(null);
    setViewportAnnouncement(null);
    setSearchIndex(0);
    setQuery(nextQuery);
  };

  const activateSearchMatch = (match: KnowledgeTreeSearchMatch): void => {
    const node = visual.byId.get(match.id);
    if (!node || searchOwnerRef.current !== props.treeOwnerKey) return;
    revealNode(node);
    focusNode(node, !match.pageId);
    if (match.pageId && match.focusKey) void props.onOpenNote(match.pageId, match.focusKey);
  };

  const openNoteFromTree = async (pageId: string, focusKey: string): Promise<void> => {
    const owner = props.treeOwnerKey;
    const fallbackId = activeId;
    try {
      await props.onOpenNote(pageId, focusKey);
    } catch {
      if (treeOwnerRef.current !== owner || activeIdRef.current !== fallbackId) return;
      const fallbackNode = visual.byId.get(fallbackId);
      if (fallbackNode) focusNode(fallbackNode, true);
    }
  };

  const closeMore = (restoreFocus = false): void => {
    setMoreOpen(false);
    if (!restoreFocus) return;
    const move = (): void => moreButtonRef.current?.focus();
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(move);
    else move();
  };

  const focusParent = (): void => {
    if (!active?.parentId) return;
    const parent = visual.byId.get(active.parentId);
    if (!parent) return;
    closeMore();
    focusNode(parent, true);
  };

  const focusRoot = (): void => {
    const root = visual.nodes[0];
    if (!root) return;
    closeMore();
    focusNode(root, true);
  };

  const showAllBranches = (): void => {
    const root = visual.nodes[0];
    if (!root) return;
    setMode("tree");
    setReviewOnly(false);
    setCollapsedIds(new Set());
    setQuery("");
    setSearchIndex(0);
    searchOriginRef.current = null;
    searchCollapseOriginRef.current = null;
    searchOwnerRef.current = null;
    closeMore();
    focusNode(root, true);
  };

  const handleMoreMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMore(true);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = Math.max(0, items.indexOf(event.target as HTMLButtonElement));
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  };

  const handleViewportKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest('[role="treeitem"]')) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom(.18);
      return;
    }
    if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom(-.18);
      return;
    }
    if (event.key === "0" || event.key === "Home") {
      event.preventDefault();
      fitTree();
      return;
    }
    if (event.key.startsWith("Arrow") && active) {
      event.preventDefault();
      nodeRefs.current.get(active.id)?.focus();
    }
  };

  const beginPointerDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if ((event.target as Element).closest('[role="treeitem"]')) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      panX: pan.x,
      panY: pan.y
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
  };

  const movePointerDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = bounds.width || 900;
    const height = bounds.height || 620;
    setPan({
      x: drag.panX + (event.clientX - drag.clientX) * (900 / width),
      y: drag.panY + (event.clientY - drag.clientY) * (620 / height)
    });
    setViewportAnnouncement(null);
  };

  const endPointerDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    setDragging(false);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>): void => {
    event.preventDefault();
    changeZoom(event.deltaY < 0 ? .12 : -.12);
  };

  const moveNodeFocus = (event: ReactKeyboardEvent<SVGGElement>, node: VisualNode): void => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Enter" || event.key === " ") {
      focusNode(node);
      return;
    }
    if (event.key === "ArrowLeft") {
      if (node.childCount > 0 && !collapsedIds.has(node.id)) {
        setBranchCollapsed(node, true);
        return;
      }
      const parent = node.parentId ? visual.byId.get(node.parentId) : undefined;
      if (parent && nodeInteractive(parent)) focusNode(parent, true);
      return;
    }
    if (event.key === "ArrowRight") {
      if (node.childCount === 0) return;
      if (collapsedIds.has(node.id)) {
        setBranchCollapsed(node, false);
        return;
      }
      const firstChild = visual.nodes.find((candidate) => candidate.parentId === node.id && nodeInteractive(candidate));
      if (firstChild) focusNode(firstChild, true);
      return;
    }
    const candidates = visual.nodes.filter((candidate) => candidate.kind !== "root" && nodeInteractive(candidate));
    if (candidates.length === 0) return;
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    const ranked = [...candidates]
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => ({
        candidate,
        primary: horizontal ? (candidate.x - node.x) * direction : (candidate.y - node.y) * direction,
        secondary: horizontal ? Math.abs(candidate.y - node.y) : Math.abs(candidate.x - node.x)
      }))
      .filter((entry) => entry.primary > 0)
      .sort((left, right) => left.primary + left.secondary * .32 - (right.primary + right.secondary * .32));
    if (ranked[0]) focusNode(ranked[0].candidate, true);
  };

  return (
    <div className={`tree-card mode-${mode}`}>
      <p id="knowledge-tree-map-description" className="visually-hidden">
        {`${props.t("knowledgeTree.showing").replace("{count}", String(visual.nodes.length - 1))}. ${props.t("knowledgeTree.canvas")}`}
      </p>
      <div className="knowledge-map-modes" role="group" aria-label={props.t("knowledgeTree.viewModes")}>
        {(["tree", "network", "list"] as const).map((nextMode) => (
          <button
            key={nextMode}
            type="button"
            className={mode === nextMode ? "knowledge-map-mode active" : "knowledge-map-mode"}
            aria-label={props.t(`knowledgeTree.mode.${nextMode}`)}
            aria-pressed={mode === nextMode}
            onClick={() => activateMode(nextMode)}
          >
            <PigeIcon name={nextMode === "tree" ? "knowledge" : nextMode === "network" ? "network" : "listTree"} size={14} />
          </button>
        ))}
      </div>

      <div
        className={dragging ? "knowledge-map-viewport is-dragging" : "knowledge-map-viewport"}
        role="region"
        tabIndex={0}
        aria-label={props.t("knowledgeTree.canvas")}
        onKeyDown={handleViewportKeyDown}
        onPointerDown={beginPointerDrag}
        onPointerMove={movePointerDrag}
        onPointerUp={endPointerDrag}
        onPointerCancel={endPointerDrag}
        onWheel={handleWheel}
      >
        <svg
          className="tree-svg"
          viewBox="0 0 900 620"
          role="tree"
          aria-label={props.t("knowledgeTree.title")}
          aria-describedby="knowledge-tree-map-description"
          aria-orientation="vertical"
        >
          <g className="knowledge-map-stage" transform={transform}>
            <g aria-hidden="true">
              {visibleNodes.filter((node) => node.parentId).map((node) => {
                const parent = visual.byId.get(node.parentId!);
                if (!parent) return null;
                const interactive = nodeInteractive(node);
                const dimmed = nodeDimmed(node);
                return (
                  <path
                    key={`branch-${node.id}`}
                    className={`knowledge-map-branch level-${Math.min(node.level, 4)}${dimmed ? " is-dimmed" : ""}`}
                    d={branchPath(parent, node)}
                    style={{
                      "--branch-width": `${branchWidth(node, visual.maxWeight)}px`,
                      "--branch-opacity": node.level <= 1 ? .58 : Math.max(.16, .46 - node.level * .06)
                    } as CSSProperties}
                  />
                );
              })}
            </g>
            <g>
              {visibleNodes.map((node) => {
                const interactive = nodeInteractive(node);
                const dimmed = nodeDimmed(node);
                const density = evidenceDensity(node);
                const densityBand = evidenceDensityBand(density);
                const radius = nodeRadius(node, visual.maxWeight, visual.maxDensity);
                const showLabel = node.kind !== "page" && (node.level <= 1 || node.id === activeId);
                return (
                  <g
                    key={node.id}
                    ref={(element) => {
                      if (element) nodeRefs.current.set(node.id, element);
                      else nodeRefs.current.delete(node.id);
                    }}
                    className={`knowledge-map-node level-${Math.min(node.level, 4)} density-${densityBand}${node.status === "needs_review" ? " needs-review" : ""}${node.id === activeId ? " active" : ""}${dimmed ? " is-dimmed" : ""}`}
                    role="treeitem"
                    aria-level={node.level + 1}
                    aria-posinset={node.siblingIndex + 1}
                    aria-setsize={node.siblingCount}
                    aria-expanded={node.childCount > 0 ? !collapsedIds.has(node.id) : undefined}
                    aria-label={node.title}
                    aria-description={formatNodeSummary(props.t, node)}
                    aria-hidden={!interactive}
                    aria-selected={node.id === activeId}
                    data-knowledge-density={density}
                    data-knowledge-leaf-count={node.leafCount}
                    tabIndex={interactive && node.id === activeId ? 0 : -1}
                    transform={`translate(${node.x} ${node.y})`}
                    onClick={() => {
                      if (interactive) focusNode(node, true);
                    }}
                    onKeyDown={(event) => moveNodeFocus(event, node)}
                  >
                    <circle className="knowledge-map-pulse" r={radius + 1} />
                    <circle r={radius} />
                    {showLabel ? (
                      <text
                        className="knowledge-map-label"
                        x={node.x < 450 ? -12 : 12}
                        y={-7}
                        textAnchor={node.x < 450 ? "end" : "start"}
                      >
                        {node.title}
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </div>

      {active ? (
        <aside className="knowledge-inspector" aria-live="polite" aria-atomic="true">
          <h2>{active.title}</h2>
          <span className="knowledge-inspector-meta">
            {props.t("knowledgeTree.weight")}: {active.weight} · {props.t("knowledgeTree.sources")}: {active.sourceCount}
          </span>
          <meter
            className="knowledge-tree-weight knowledge-map-weight"
            min={0}
            max={visual.maxWeight}
            value={Math.min(active.weight, visual.maxWeight)}
            aria-label={`${props.t("knowledgeTree.weight")}: ${active.weight}`}
          />
          <p>{props.t(`knowledgeTree.kind.${active.kind === "page" || active.kind === "root" ? "concept" : active.kind}`)}</p>
          <div className="knowledge-inspector-tags">
            <span>{props.t("knowledgeTree.fragments")} {active.fragmentCount}</span>
            <span>{props.t("knowledgeTree.leaves")} {active.leafCount}</span>
            <span>{props.t("knowledgeTree.density")} {evidenceDensity(active)}</span>
          </div>
          {active.pageId && active.focusKey ? (
            <button
              className="knowledge-inspector-open"
              type="button"
              data-knowledge-action="open-page"
              data-knowledge-open-key={active.focusKey}
              disabled={props.noteLoadingPageId === active.pageId}
              onClick={() => void openNoteFromTree(active.pageId!, active.focusKey!)}
            >
              {props.t("knowledgeTree.open")}
            </button>
          ) : activeChildren.length > 0 ? (
            <button
              className="knowledge-inspector-open"
              type="button"
              data-knowledge-action="browse-branch"
              onClick={() => focusNode(activeChildren[0]!, true)}
            >
              {props.t("knowledgeTree.browseBranch")}
            </button>
          ) : null}
          {active.childCount > 0 ? (
            <button
              className="knowledge-inspector-open"
              type="button"
              data-knowledge-action="toggle-branch"
              aria-expanded={!collapsedIds.has(active.id)}
              onClick={() => setBranchCollapsed(active, !collapsedIds.has(active.id))}
            >
              {props.t(collapsedIds.has(active.id) ? "knowledgeTree.expand" : "knowledgeTree.collapse")}
            </button>
          ) : null}
          {!collapsedIds.has(active.id) && (activeChildren.length > 0 || !active.pageId) ? (
            <KnowledgeTreeBranchPanel
              children={activeChildren}
              onSelect={(node) => focusNode(node, true)}
              t={props.t}
            />
          ) : null}
          {active.pageId && active.focusKey ? (
            <KnowledgeTreeRelatedPanel
              state={related.owner === relatedOwnerRef.current ? related.value : "loading"}
              ownerFocusKey={active.focusKey}
              noteLoadingPageId={props.noteLoadingPageId}
              onOpenNote={openNoteFromTree}
              t={props.t}
            />
          ) : null}
        </aside>
      ) : null}

      <div className="knowledge-minimap" aria-hidden="true">
        <svg viewBox={`0 0 ${visual.layoutWidth} 620`} preserveAspectRatio="xMidYMid meet">
          {visibleNodes.filter((node) => node.parentId).map((node) => {
            const parent = visual.byId.get(node.parentId!);
            if (!parent) return null;
            return (
              <path
                key={"minimap-" + node.id}
                d={branchPath(parent, node)}
                style={{
                  "--minimap-width": Math.max(.5, branchWidth(node, visual.maxWeight) * .32),
                  "--minimap-opacity": Math.min(.7, (node.level <= 1 ? .58 : Math.max(.16, .46 - node.level * .06)) + .08)
                } as CSSProperties}
              />
            );
          })}
        </svg>
      </div>

      <div className="knowledge-map-controls" role="group" aria-label={props.t("knowledgeTree.zoom") }>
        <button type="button" className="knowledge-map-control" aria-label={props.t("knowledgeTree.zoomOut")} onClick={() => changeZoom(-.18)}>
          <PigeIcon name="zoomOut" size={15} />
        </button>
        <button type="button" className="knowledge-map-control" aria-label={props.t("knowledgeTree.zoomIn")} onClick={() => changeZoom(.18)}>
          <PigeIcon name="zoomIn" size={15} />
        </button>
        <button type="button" className="knowledge-map-control" aria-label={props.t("knowledgeTree.fit")} onClick={fitTree}>
          <PigeIcon name="fit" size={15} />
        </button>
      </div>

      <p id="knowledge-map-status" className="knowledge-map-status" role="status">
        {viewportAnnouncement?.kind === "focused"
          ? props.t("knowledgeTree.focused").replace("{title}", viewportAnnouncement.title)
          : viewportAnnouncement?.kind === "zoom"
            ? props.t("knowledgeTree.zoomStatus").replace("{percent}", String(viewportAnnouncement.percent))
            : normalizedQuery
                ? props.t("knowledgeTree.searching").replace("{count}", String(searchMatches.length))
                : announcedMode
                  ? props.t(`knowledgeTree.modeStatus.${announcedMode}`)
                  : props.t("knowledgeTree.showing").replace("{count}", String(visual.nodes.filter((node) => node.kind !== "root" && nodeInteractive(node)).length))}
      </p>

      <div className="knowledge-map-local-tools">
        <KnowledgeTreeSearchControl query={query} matches={searchMatches} selectedIndex={searchIndex}
          onQueryChange={updateQuery} onSelectedIndexChange={setSearchIndex}
          onActivate={activateSearchMatch} t={props.t} />
        <button
          type="button"
          className="icon-button knowledge-toolbar-action filter"
          aria-label={props.t("knowledgeTree.filter")}
          aria-pressed={reviewOnly}
          onClick={() => {
            setAnnouncedMode(null);
            setViewportAnnouncement(null);
            setReviewOnly((value) => !value);
          }}
        >
          <PigeIcon name="filter" size={15} />
        </button>
        <button
          ref={moreButtonRef}
          type="button"
          className="icon-button knowledge-toolbar-action"
          aria-label={props.t("knowledgeTree.more")}
          data-knowledge-action="more"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          aria-controls="knowledge-tree-more-menu"
          onClick={() => setMoreOpen((value) => !value)}
        >
          <PigeIcon name="more" size={15} />
        </button>
        {moreOpen ? (
          <div
            ref={moreMenuRef}
            id="knowledge-tree-more-menu"
            className="knowledge-tree-more-menu"
            role="menu"
            aria-label={props.t("knowledgeTree.more")}
            onKeyDown={handleMoreMenuKeyDown}
          >
            {active?.parentId ? (
              <button type="button" role="menuitem" data-knowledge-action="back-parent" onClick={focusParent}>
                {props.t("knowledgeTree.backToParent")}
              </button>
            ) : null}
            {active?.parentId && visual.byId.get(active.parentId)?.parentId ? (
              <button type="button" role="menuitem" data-knowledge-action="go-root" onClick={focusRoot}>
                {props.t("knowledgeTree.goToRoot")}
              </button>
            ) : null}
            <button type="button" role="menuitem" data-knowledge-action="show-all" onClick={showAllBranches}>
              {props.t("knowledgeTree.showAllBranches")}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function buildVisualTree(roots: readonly KnowledgeTreeNode[], t: (key: string) => string): VisualTree {
  const layoutRoots = roots.map((node, index) => buildKnowledgeLayoutNode(
    node,
    "pige-root",
    1,
    `root-${index}`,
    index,
    roots.length,
    t
  ));
  const terminalCount = Math.max(1, layoutRoots.reduce((total, node) => total + layoutTerminalCount(node), 0));
  const layoutWidth = Math.max(900, 76 + Math.max(0, terminalCount - 1) * 28);
  const maxDepth = Math.max(1, ...layoutRoots.map(layoutDepth));
  let nextTerminalX = (layoutWidth - Math.max(0, terminalCount - 1) * 28) / 2;
  const nodes: VisualNode[] = [];
  const appendPositioned = (node: LayoutNode): number => {
    const childXs = node.children.map(appendPositioned);
    const x = childXs.length > 0
      ? (childXs[0]! + childXs[childXs.length - 1]!) / 2
      : nextTerminalX;
    if (childXs.length === 0) nextTerminalX += 28;
    const { children: _children, ...visualNode } = node;
    nodes.push({
      ...visualNode,
      x,
      y: 580 - node.level / maxDepth * 520,
      childCount: node.children.length
    });
    return x;
  };
  layoutRoots.forEach(appendPositioned);
  nodes.push({
    id: "pige-root",
    parentId: null,
    title: t("knowledgeTree.root"),
    kind: "root",
    level: 0,
    x: layoutWidth / 2,
    y: 590,
    weight: roots.reduce((sum, node) => sum + node.metrics.weight, 0),
    fragmentCount: roots.reduce((sum, node) => sum + node.metrics.fragmentPageCount, 0),
    sourceCount: roots.reduce((sum, node) => sum + node.metrics.sourceCount, 0),
    leafCount: roots.reduce((sum, node) => sum + node.metrics.leafCount, 0),
    status: "active",
    siblingIndex: 0,
    siblingCount: 1,
    childCount: roots.length
  });
  nodes.sort((left, right) => left.level - right.level || left.x - right.x || left.id.localeCompare(right.id));
  const fitZoom = layoutWidth <= 900 ? 1 : 820 / layoutWidth;
  const fitPan = layoutWidth <= 900 ? { x: 0, y: 0 } : { x: (900 - layoutWidth * fitZoom) / 2, y: 0 };

  return {
    nodes,
    byId: new Map(nodes.map((node) => [node.id, node])),
    maxWeight: Math.max(1, ...nodes.map((node) => node.weight)),
    maxDensity: Math.max(1, ...nodes.map(evidenceDensity)),
    layoutWidth,
    fitZoom,
    fitPan
  };
}

function buildKnowledgeLayoutNode(
  node: KnowledgeTreeNode,
  parentId: string,
  level: number,
  pathKey: string,
  siblingIndex: number,
  siblingCount: number,
  t: (key: string) => string
): LayoutNode {
  const id = `node-${pathKey}-${node.id}`;
  const childCount = node.children.length + node.pageRefs.length;
  const children: LayoutNode[] = [
    ...node.children.map((child, index) => buildKnowledgeLayoutNode(
      child,
      id,
      level + 1,
      `${pathKey}-child-${index}`,
      index,
      childCount,
      t
    )),
    ...node.pageRefs.map((page, index) => buildPageLayoutNode(
      page,
      id,
      level + 1,
      `${pathKey}-page-${index}`,
      node.children.length + index,
      childCount
    ))
  ];
  return {
    id,
    parentId,
    title: node.kind === "source" && !node.navigation
      ? t("knowledgeTree.sourceEvidence")
      : node.synthetic
        ? t("knowledgeTree.unassigned")
        : node.title,
    kind: node.kind,
    level,
    weight: node.metrics.weight,
    fragmentCount: node.metrics.fragmentPageCount,
    sourceCount: node.metrics.sourceCount,
    leafCount: node.metrics.leafCount,
    status: node.status,
    siblingIndex,
    siblingCount,
    children,
    ...(node.navigation ? { pageId: node.navigation.pageId, focusKey: `${pathKey}-node` } : {})
  };
}

function buildPageLayoutNode(
  page: KnowledgeTreePageRef,
  parentId: string,
  level: number,
  focusKey: string,
  siblingIndex: number,
  siblingCount: number
): LayoutNode {
  return {
    id: `page-${focusKey}-${page.pageId}`,
    parentId,
    title: page.title,
    kind: "page",
    level,
    weight: Math.max(1, page.sourceIds.length),
    fragmentCount: 1,
    sourceCount: page.sourceIds.length,
    leafCount: 1,
    status: page.status,
    siblingIndex,
    siblingCount,
    children: [],
    pageId: page.pageId,
    focusKey
  };
}

function layoutTerminalCount(node: LayoutNode): number {
  return node.children.length === 0
    ? 1
    : node.children.reduce((total, child) => total + layoutTerminalCount(child), 0);
}

function layoutDepth(node: LayoutNode): number {
  return node.children.length === 0 ? node.level : Math.max(...node.children.map(layoutDepth));
}

function branchPath(parent: VisualNode, node: VisualNode): string {
  const vertical = node.y - parent.y;
  return `M ${parent.x} ${parent.y} C ${parent.x} ${parent.y + vertical * .36}, ${node.x} ${node.y - vertical * .28}, ${node.x} ${node.y}`;
}

function branchWidth(node: VisualNode, maxWeight: number): number {
  const ratio = Math.max(.08, node.weight / maxWeight);
  return node.level <= 1 ? .9 + Math.pow(ratio, .58) * 7 : .45 + Math.pow(ratio, .6) * 2.2;
}

function nodeRadius(node: VisualNode, maxWeight: number, maxDensity: number): number {
  if (node.kind === "root") return 6.8;
  const ratio = Math.max(.08, node.kind === "domain" || node.kind === "topic"
    ? node.weight / maxWeight
    : evidenceDensity(node) / maxDensity);
  return Math.min(6.2, 1.65 + Math.pow(ratio, .52) * (node.level <= 1 ? 5 : 3.2));
}
