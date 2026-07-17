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
import type { KnowledgeTreeNode, KnowledgeTreePageRef } from "@pige/contracts";
import { PigeIcon } from "./PigeIcon";

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
  readonly status: KnowledgeTreeNode["status"] | KnowledgeTreePageRef["status"] | "active";
  readonly pageId?: string;
  readonly focusKey?: string;
};

type VisualTree = {
  readonly nodes: readonly VisualNode[];
  readonly byId: ReadonlyMap<string, VisualNode>;
  readonly maxWeight: number;
};

type ViewportAnnouncement =
  | { readonly kind: "focused"; readonly title: string }
  | { readonly kind: "zoom"; readonly percent: number }
  | { readonly kind: "secondary-unavailable" };

type PointerDrag = {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly panX: number;
  readonly panY: number;
};

export function KnowledgeTreeMap(props: {
  readonly roots: readonly KnowledgeTreeNode[];
  readonly noteLoadingPageId: string | null;
  readonly onOpenNote: (pageId: string, focusKey: string) => Promise<void>;
  readonly t: (key: string) => string;
}): React.JSX.Element {
  const visual = useMemo(() => buildVisualTree(props.roots, props.t), [props.roots, props.t]);
  const [mode, setMode] = useState<TreeMode>("tree");
  const [announcedMode, setAnnouncedMode] = useState<TreeMode | null>(null);
  const [query, setQuery] = useState("");
  const [reviewOnly, setReviewOnly] = useState(false);
  const [activeId, setActiveId] = useState(() => visual.nodes[1]?.id ?? visual.nodes[0]?.id ?? "pige-root");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const [viewportAnnouncement, setViewportAnnouncement] = useState<ViewportAnnouncement | null>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const pointerDragRef = useRef<PointerDrag | null>(null);
  const searchOriginRef = useRef<string | null>(null);
  const active = visual.byId.get(activeId) ?? visual.nodes[0];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const transform = `translate(${pan.x} ${pan.y}) scale(${zoom})`;

  const nodeInteractive = (node: VisualNode): boolean => {
    if (mode === "list" && node.level >= 3) return false;
    if (reviewOnly && node.status !== "needs_review" && node.kind !== "root") return false;
    return true;
  };

  const nodeSearchMatch = (node: VisualNode): boolean =>
    !normalizedQuery || node.title.toLocaleLowerCase().includes(normalizedQuery);

  const nodeDimmed = (node: VisualNode): boolean => !nodeInteractive(node) || !nodeSearchMatch(node);

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
    const nextZoom = replacement.kind === "root" ? 1 : replacement.level <= 1 ? 1.24 : 1.5;
    setZoom(nextZoom);
    setPan(replacement.kind === "root"
      ? { x: 0, y: 0 }
      : { x: 450 - replacement.x * nextZoom, y: 310 - replacement.y * nextZoom });
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
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
    if (nextMode !== "list" || !active || active.level < 3) return;
    let visibleAncestor = active;
    while (visibleAncestor.level >= 3 && visibleAncestor.parentId) {
      visibleAncestor = visual.byId.get(visibleAncestor.parentId) ?? visual.nodes[0]!;
    }
    setActiveId(visibleAncestor.id);
    const nextZoom = visibleAncestor.kind === "root" ? 1 : 1.24;
    setZoom(nextZoom);
    setPan(visibleAncestor.kind === "root"
      ? { x: 0, y: 0 }
      : { x: 450 - visibleAncestor.x * nextZoom, y: 310 - visibleAncestor.y * nextZoom });
  };

  const focusNode = (node: VisualNode, moveFocus = false, announce = true): void => {
    setActiveId(node.id);
    const nextZoom = node.kind === "root" ? 1 : node.level <= 1 ? 1.24 : 1.5;
    setZoom(nextZoom);
    setPan(node.kind === "root"
      ? { x: 0, y: 0 }
      : { x: 450 - node.x * nextZoom, y: 310 - node.y * nextZoom });
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
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setAnnouncedMode(null);
    setViewportAnnouncement({ kind: "zoom", percent: 100 });
  };

  const announceSecondaryUnavailable = (): void => {
    setAnnouncedMode(null);
    setViewportAnnouncement({ kind: "secondary-unavailable" });
  };

  const updateQuery = (nextQuery: string): void => {
    if (!query && nextQuery) searchOriginRef.current = activeId;
    if (query && !nextQuery) {
      const origin = searchOriginRef.current ? visual.byId.get(searchOriginRef.current) : undefined;
      searchOriginRef.current = null;
      if (origin && nodeInteractive(origin)) focusNode(origin, false, false);
    }
    setAnnouncedMode(null);
    setViewportAnnouncement(null);
    setQuery(nextQuery);
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
        <svg className="tree-svg" viewBox="0 0 900 620" role="tree" aria-label={props.t("knowledgeTree.title")}>
          <g className="knowledge-map-stage" transform={transform}>
            <g aria-hidden="true">
              {visual.nodes.filter((node) => node.parentId).map((node) => {
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
              {visual.nodes.map((node) => {
                const interactive = nodeInteractive(node);
                const dimmed = nodeDimmed(node);
                const radius = nodeRadius(node, visual.maxWeight);
                const showLabel = node.kind !== "page" && (node.level <= 1 || node.id === activeId);
                return (
                  <g
                    key={node.id}
                    ref={(element) => {
                      if (element) nodeRefs.current.set(node.id, element);
                      else nodeRefs.current.delete(node.id);
                    }}
                    className={`knowledge-map-node level-${Math.min(node.level, 4)}${node.id === activeId ? " active" : ""}${dimmed ? " is-dimmed" : ""}`}
                    role="treeitem"
                    aria-level={node.level + 1}
                    aria-label={node.title}
                    aria-hidden={!interactive}
                    aria-selected={node.id === activeId}
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
            <span>{props.t("knowledgeTree.leaves")} {active.level}</span>
          </div>
          {active.pageId && active.focusKey ? (
            <button
              className="knowledge-inspector-open"
              type="button"
              data-knowledge-action="open-page"
              data-knowledge-open-key={active.focusKey}
              disabled={props.noteLoadingPageId === active.pageId}
              onClick={() => void props.onOpenNote(active.pageId!, active.focusKey!)}
            >
              {props.t("knowledgeTree.open")}
            </button>
          ) : (
            <button
              className="knowledge-inspector-open"
              type="button"
              data-knowledge-action="open-topic"
              aria-describedby="knowledge-map-status"
              onClick={announceSecondaryUnavailable}
            >
              {props.t("knowledgeTree.open")}
            </button>
          )}
        </aside>
      ) : null}

      <div className="knowledge-minimap" aria-hidden="true">
        <svg viewBox="0 0 900 620" preserveAspectRatio="xMidYMid meet">
          {visual.nodes.filter((node) => node.parentId).map((node) => {
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
            : viewportAnnouncement?.kind === "secondary-unavailable"
              ? props.t("knowledgeTree.secondaryUnavailable")
              : normalizedQuery
                ? props.t("knowledgeTree.searching").replace("{count}", String(visual.nodes.filter((node) => nodeInteractive(node) && nodeSearchMatch(node)).length))
                : announcedMode
                  ? props.t(`knowledgeTree.modeStatus.${announcedMode}`)
                  : props.t("knowledgeTree.showing").replace("{count}", String(visual.nodes.filter((node) => node.kind !== "root" && nodeInteractive(node)).length))}
      </p>

      <div className="knowledge-map-local-tools">
        <label className="knowledge-toolbar-search">
          <PigeIcon name="search" size={14} />
          <input
            type="search"
            value={query}
            placeholder={props.t("knowledgeTree.search")}
            aria-label={props.t("knowledgeTree.search")}
            onInput={(event) => {
              updateQuery(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                updateQuery("");
                return;
              }
              if (event.key !== "Enter" || !normalizedQuery) return;
              const match = visual.nodes.find((node) => nodeInteractive(node) && nodeSearchMatch(node));
              if (!match) return;
              event.preventDefault();
              focusNode(match, true);
            }}
          />
        </label>
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
          type="button"
          className="icon-button knowledge-toolbar-action"
          aria-label={props.t("knowledgeTree.more")}
          data-knowledge-action="more"
          aria-describedby="knowledge-map-status"
          onClick={announceSecondaryUnavailable}
        >
          <PigeIcon name="more" size={15} />
        </button>
      </div>
    </div>
  );
}

function buildVisualTree(roots: readonly KnowledgeTreeNode[], t: (key: string) => string): VisualTree {
  const nodes: VisualNode[] = [{
    id: "pige-root",
    parentId: null,
    title: t("knowledgeTree.root"),
    kind: "root",
    level: 0,
    x: 450,
    y: 590,
    weight: roots.reduce((sum, node) => sum + node.metrics.weight, 0),
    fragmentCount: roots.reduce((sum, node) => sum + node.metrics.fragmentPageCount, 0),
    sourceCount: roots.reduce((sum, node) => sum + node.metrics.sourceCount, 0),
    status: "active"
  }];
  const rootSpan = Math.PI * .82;

  roots.forEach((node, index) => {
    const ratio = roots.length <= 1 ? .5 : index / (roots.length - 1);
    const angle = -Math.PI + (Math.PI - rootSpan) / 2 + rootSpan * ratio;
    appendKnowledgeNode(nodes, node, "pige-root", { x: 450, y: 590 }, angle, 1, `root-${index}`, t);
  });

  return {
    nodes,
    byId: new Map(nodes.map((node) => [node.id, node])),
    maxWeight: Math.max(1, ...nodes.map((node) => node.weight))
  };
}

function appendKnowledgeNode(
  target: VisualNode[],
  node: KnowledgeTreeNode,
  parentId: string,
  parent: { readonly x: number; readonly y: number },
  angle: number,
  level: number,
  pathKey: string,
  t: (key: string) => string
): void {
  const distance = level === 1 ? 275 : level === 2 ? 118 : Math.max(46, 82 - level * 7);
  const x = clamp(parent.x + Math.cos(angle) * distance, 38, 862);
  const y = clamp(parent.y + Math.sin(angle) * distance, 34, 580);
  const id = `node-${pathKey}-${node.id}`;
  target.push({
    id,
    parentId,
    title: node.kind === "source" && !node.navigation
      ? t("knowledgeTree.sourceEvidence")
      : node.synthetic
        ? t("knowledgeTree.unassigned")
        : node.title,
    kind: node.kind,
    level,
    x,
    y,
    weight: node.metrics.weight,
    fragmentCount: node.metrics.fragmentPageCount,
    sourceCount: node.metrics.sourceCount,
    status: node.status,
    ...(node.navigation ? { pageId: node.navigation.pageId, focusKey: `${pathKey}-node` } : {})
  });

  const children = [
    ...node.children.map((child, index) => ({ type: "node" as const, child, index })),
    ...node.pageRefs.map((page, index) => ({ type: "page" as const, page, index }))
  ];
  const spread = Math.min(.9, .23 + children.length * .055) / Math.max(1, level * .72);
  children.forEach((child, index) => {
    const offset = children.length <= 1 ? 0 : (index / (children.length - 1) - .5) * spread;
    if (child.type === "node") {
      appendKnowledgeNode(target, child.child, id, { x, y }, angle + offset, level + 1, `${pathKey}-child-${child.index}`, t);
      return;
    }
    appendPageNode(target, child.page, id, { x, y }, angle + offset, level + 1, `${pathKey}-page-${child.index}`);
  });
}

function appendPageNode(
  target: VisualNode[],
  page: KnowledgeTreePageRef,
  parentId: string,
  parent: { readonly x: number; readonly y: number },
  angle: number,
  level: number,
  focusKey: string
): void {
  const distance = Math.max(40, 70 - level * 6);
  target.push({
    id: `page-${focusKey}-${page.pageId}`,
    parentId,
    title: page.title,
    kind: "page",
    level,
    x: clamp(parent.x + Math.cos(angle) * distance, 30, 870),
    y: clamp(parent.y + Math.sin(angle) * distance, 26, 584),
    weight: Math.max(1, page.sourceIds.length),
    fragmentCount: 1,
    sourceCount: page.sourceIds.length,
    status: page.status,
    pageId: page.pageId,
    focusKey
  });
}

function branchPath(parent: VisualNode, node: VisualNode): string {
  const vertical = node.y - parent.y;
  return `M ${parent.x} ${parent.y} C ${parent.x} ${parent.y + vertical * .36}, ${node.x} ${node.y - vertical * .28}, ${node.x} ${node.y}`;
}

function branchWidth(node: VisualNode, maxWeight: number): number {
  const ratio = Math.max(.08, node.weight / maxWeight);
  return node.level <= 1 ? .9 + Math.pow(ratio, .58) * 7 : .45 + Math.pow(ratio, .6) * 2.2;
}

function nodeRadius(node: VisualNode, maxWeight: number): number {
  if (node.kind === "root") return 6.8;
  const ratio = Math.max(.08, node.weight / maxWeight);
  return Math.min(6.2, 1.65 + Math.pow(ratio, .52) * (node.level <= 1 ? 5 : 3.2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
