import type { LibraryPageSummary } from "@pige/contracts";

export type KnowledgeTreeNodeKind = "domain" | "topic" | "concept" | "source";
export type KnowledgeTreeRelationType = "has_topic" | "links_to";

export interface KnowledgeTreeRelationInput {
  readonly fromPageId: string;
  readonly toPageId: string;
  readonly relationType: KnowledgeTreeRelationType;
}

export interface KnowledgeTreeNavigation {
  readonly pageId: string;
  readonly pagePath: string;
}

export interface KnowledgeTreePageRef extends KnowledgeTreeNavigation {
  readonly title: string;
  readonly pageType: LibraryPageSummary["pageType"];
  readonly status: LibraryPageSummary["status"];
  readonly sourceIds: readonly string[];
}

export interface KnowledgeTreeMetrics {
  readonly structuralPageCount: number;
  readonly fragmentPageCount: number;
  readonly sourceCount: number;
  readonly leafCount: number;
  readonly weight: number;
}

export interface KnowledgeTreeNode {
  readonly id: string;
  readonly kind: KnowledgeTreeNodeKind;
  readonly title: string;
  readonly synthetic?: true;
  readonly pageType?: LibraryPageSummary["pageType"];
  readonly status?: LibraryPageSummary["status"];
  readonly navigation?: KnowledgeTreeNavigation;
  readonly sourceId?: string;
  readonly relatedParentPageIds: readonly string[];
  readonly pageRefs: readonly KnowledgeTreePageRef[];
  readonly sourceRefs: readonly string[];
  readonly metrics: KnowledgeTreeMetrics;
  readonly children: readonly KnowledgeTreeNode[];
}

export interface KnowledgeTreeSnapshot {
  readonly schemaVersion: 1;
  readonly state: "empty" | "ready";
  readonly invalidPageCount: number;
  readonly totals: {
    readonly pageCount: number;
    readonly topicCount: number;
    readonly conceptCount: number;
    readonly fragmentPageCount: number;
    readonly sourceCount: number;
    readonly leafCount: number;
  };
  readonly roots: readonly KnowledgeTreeNode[];
}

interface MutableStructuralNode {
  readonly id: string;
  readonly title: string;
  readonly page?: LibraryPageSummary;
  readonly synthetic: boolean;
  readonly childIds: Set<string>;
  readonly relatedParentPageIds: Set<string>;
  readonly directPages: Map<string, LibraryPageSummary>;
  readonly directSourceRefs: Set<string>;
}

const UNASSIGNED_DOMAIN_ID = "knowledge-domain:unassigned";

export function buildKnowledgeTreeSnapshot(
  pages: readonly LibraryPageSummary[],
  relations: readonly KnowledgeTreeRelationInput[],
  invalidPageCount: number
): KnowledgeTreeSnapshot {
  const includedPages = pages.filter((page) => page.status !== "archived").sort(comparePages);
  const pageById = new Map(includedPages.map((page) => [page.pageId, page]));
  const topicIds = new Set(includedPages.filter((page) => page.pageType === "topic").map((page) => page.pageId));
  const conceptIds = new Set(includedPages.filter((page) => page.pageType === "concept").map((page) => page.pageId));
  const explicitTopics = groupRelationTargets(relations, "has_topic", pageById);
  const linkedPages = groupRelationTargets(relations, "links_to", pageById);
  const nodes = new Map<string, MutableStructuralNode>();

  for (const page of includedPages) {
    if (page.pageType !== "topic" && page.pageType !== "concept") continue;
    nodes.set(page.pageId, createStructuralNode(page));
  }

  const topicParentById = chooseTopicParents(topicIds, explicitTopics, pageById);
  for (const topicId of sortPageIds(topicIds, pageById)) {
    const node = nodes.get(topicId);
    if (!node) continue;
    const candidates = relationCandidates(explicitTopics.get(topicId), topicIds, pageById);
    const parentId = topicParentById.get(topicId);
    if (parentId) nodes.get(parentId)?.childIds.add(topicId);
    for (const candidate of candidates) {
      if (candidate !== parentId) node.relatedParentPageIds.add(candidate);
    }
  }

  let unassigned: MutableStructuralNode | undefined;
  const requireUnassigned = (): MutableStructuralNode => {
    if (!unassigned) {
      unassigned = {
        id: UNASSIGNED_DOMAIN_ID,
        title: "Unassigned",
        synthetic: true,
        childIds: new Set(),
        relatedParentPageIds: new Set(),
        directPages: new Map(),
        directSourceRefs: new Set()
      };
      nodes.set(unassigned.id, unassigned);
    }
    return unassigned;
  };

  for (const conceptId of sortPageIds(conceptIds, pageById)) {
    const node = nodes.get(conceptId);
    const explicitCandidates = relationCandidates(explicitTopics.get(conceptId), topicIds, pageById);
    const linkedCandidates = relationCandidates(linkedPages.get(conceptId), topicIds, pageById);
    const candidates = explicitCandidates.length > 0 ? explicitCandidates : linkedCandidates;
    const parentId = candidates[0];
    (parentId ? nodes.get(parentId) : requireUnassigned())?.childIds.add(conceptId);
    for (const candidate of candidates.slice(1)) node?.relatedParentPageIds.add(candidate);
  }

  for (const page of includedPages) {
    const structuralNode = nodes.get(page.pageId);
    if (structuralNode && !structuralNode.synthetic) {
      addSourceRefs(structuralNode.directSourceRefs, page.sourceIds);
      continue;
    }

    const explicitCandidates = relationCandidates(explicitTopics.get(page.pageId), topicIds, pageById);
    const linkedConcepts = relationCandidates(linkedPages.get(page.pageId), conceptIds, pageById);
    const linkedTopics = relationCandidates(linkedPages.get(page.pageId), topicIds, pageById);
    const parentId = explicitCandidates[0] ?? linkedConcepts[0] ?? linkedTopics[0];
    const parent = parentId ? nodes.get(parentId) : requireUnassigned();
    if (!parent) continue;
    if (page.pageType !== "source") parent.directPages.set(page.pageId, page);
    addSourceRefs(parent.directSourceRefs, page.sourceIds);
  }

  const sourcePageById = createSourcePageLookup(includedPages);
  const topicRoots = sortPageIds(topicIds, pageById)
    .filter((topicId) => !topicParentById.has(topicId))
    .map((topicId) => buildNode(topicId, nodes, sourcePageById, true));
  const roots = topicRoots.sort(compareNodes);
  if (unassigned && hasAggregateContent(unassigned)) {
    roots.push(buildNode(unassigned.id, nodes, sourcePageById, true));
  }

  const sourceIds = new Set(includedPages.flatMap((page) => page.sourceIds));
  const fragmentPageCount = includedPages.filter(
    (page) => page.pageType !== "topic" && page.pageType !== "concept" && page.pageType !== "source"
  ).length;

  return {
    schemaVersion: 1,
    state: roots.length === 0 ? "empty" : "ready",
    invalidPageCount,
    totals: {
      pageCount: includedPages.length,
      topicCount: topicIds.size,
      conceptCount: conceptIds.size,
      fragmentPageCount,
      sourceCount: sourceIds.size,
      leafCount: roots.reduce((total, root) => total + root.metrics.leafCount, 0)
    },
    roots
  };
}

function createStructuralNode(page: LibraryPageSummary): MutableStructuralNode {
  return {
    id: page.pageId,
    title: page.title,
    page,
    synthetic: false,
    childIds: new Set(),
    relatedParentPageIds: new Set(),
    directPages: new Map(),
    directSourceRefs: new Set()
  };
}

function chooseTopicParents(
  topicIds: ReadonlySet<string>,
  explicitTopics: ReadonlyMap<string, ReadonlySet<string>>,
  pageById: ReadonlyMap<string, LibraryPageSummary>
): Map<string, string> {
  const parentById = new Map<string, string>();
  for (const topicId of sortPageIds(topicIds, pageById)) {
    for (const candidate of relationCandidates(explicitTopics.get(topicId), topicIds, pageById)) {
      if (candidate !== topicId && !wouldCreateCycle(topicId, candidate, parentById)) {
        parentById.set(topicId, candidate);
        break;
      }
    }
  }
  return parentById;
}

function wouldCreateCycle(childId: string, parentId: string, parentById: ReadonlyMap<string, string>): boolean {
  const visited = new Set<string>();
  let cursor: string | undefined = parentId;
  while (cursor && !visited.has(cursor)) {
    if (cursor === childId) return true;
    visited.add(cursor);
    cursor = parentById.get(cursor);
  }
  return false;
}

function buildNode(
  nodeId: string,
  nodes: ReadonlyMap<string, MutableStructuralNode>,
  sourcePageById: ReadonlyMap<string, LibraryPageSummary>,
  isRoot: boolean
): KnowledgeTreeNode {
  const built = new Map<string, KnowledgeTreeNode>();
  const stack: Array<{ readonly nodeId: string; readonly isRoot: boolean; readonly expanded: boolean }> = [
    { nodeId, isRoot, expanded: false }
  ];

  while (stack.length > 0) {
    const frame = stack.pop();
    if (!frame || built.has(frame.nodeId)) continue;
    const node = nodes.get(frame.nodeId);
    if (!node) throw new Error(`Missing Knowledge Tree node: ${frame.nodeId}`);

    if (!frame.expanded) {
      stack.push({ ...frame, expanded: true });
      for (const childId of Array.from(node.childIds).reverse()) {
        if (!built.has(childId)) stack.push({ nodeId: childId, isRoot: false, expanded: false });
      }
      continue;
    }

    const structuralChildren = Array.from(node.childIds).map((childId) => {
      const child = built.get(childId);
      if (!child) throw new Error(`Knowledge Tree child was not built: ${childId}`);
      return child;
    }).sort(compareNodes);
    built.set(frame.nodeId, finalizeNode(node, structuralChildren, sourcePageById, frame.isRoot));
  }

  const root = built.get(nodeId);
  if (!root) throw new Error(`Knowledge Tree root was not built: ${nodeId}`);
  return root;
}

function finalizeNode(
  node: MutableStructuralNode,
  structuralChildren: readonly KnowledgeTreeNode[],
  sourcePageById: ReadonlyMap<string, LibraryPageSummary>,
  isRoot: boolean
): KnowledgeTreeNode {
  const sourceChildren = Array.from(node.directSourceRefs)
    .sort(compareText)
    .map((sourceId) => buildSourceNode(node.id, sourceId, sourcePageById.get(sourceId)));
  const children = [...structuralChildren, ...sourceChildren];
  const pageRefs = Array.from(node.directPages.values()).sort(comparePages).map(toPageRef);
  const sourceRefs = new Set(node.directSourceRefs);
  for (const child of structuralChildren) addSourceRefs(sourceRefs, child.sourceRefs);
  const sortedSourceRefs = Array.from(sourceRefs).sort(compareText);
  const structuralPageCount = (node.page ? 1 : 0) + structuralChildren.reduce(
    (total, child) => total + child.metrics.structuralPageCount,
    0
  );
  const fragmentPageCount = pageRefs.length + structuralChildren.reduce(
    (total, child) => total + child.metrics.fragmentPageCount,
    0
  );
  const leafCount = pageRefs.length + children.reduce((total, child) => total + child.metrics.leafCount, 0);
  const sourceCount = sortedSourceRefs.length;

  return {
    id: node.id,
    kind: node.synthetic || (isRoot && node.page?.pageType === "topic") ? "domain" : node.page?.pageType === "topic" ? "topic" : "concept",
    title: node.title,
    ...(node.synthetic ? { synthetic: true as const } : {}),
    ...(node.page ? {
      pageType: node.page.pageType,
      status: node.page.status,
      navigation: { pageId: node.page.pageId, pagePath: node.page.pagePath }
    } : {}),
    relatedParentPageIds: Array.from(node.relatedParentPageIds).sort(compareText),
    pageRefs,
    sourceRefs: sortedSourceRefs,
    metrics: {
      structuralPageCount,
      fragmentPageCount,
      sourceCount,
      leafCount,
      weight: structuralPageCount + fragmentPageCount + sourceCount
    },
    children
  };
}

function buildSourceNode(
  parentId: string,
  sourceId: string,
  sourcePage: LibraryPageSummary | undefined
): KnowledgeTreeNode {
  return {
    id: `${parentId}/source:${sourceId}`,
    kind: "source",
    title: sourcePage?.title ?? sourceId,
    ...(sourcePage ? {
      pageType: sourcePage.pageType,
      status: sourcePage.status,
      navigation: { pageId: sourcePage.pageId, pagePath: sourcePage.pagePath }
    } : {}),
    sourceId,
    relatedParentPageIds: [],
    pageRefs: [],
    sourceRefs: [sourceId],
    metrics: {
      structuralPageCount: 0,
      fragmentPageCount: 0,
      sourceCount: 1,
      leafCount: 1,
      weight: 1
    },
    children: []
  };
}

function groupRelationTargets(
  relations: readonly KnowledgeTreeRelationInput[],
  relationType: KnowledgeTreeRelationType,
  pageById: ReadonlyMap<string, LibraryPageSummary>
): Map<string, Set<string>> {
  const grouped = new Map<string, Set<string>>();
  for (const relation of relations) {
    if (relation.relationType !== relationType || !pageById.has(relation.fromPageId) || !pageById.has(relation.toPageId)) {
      continue;
    }
    const targets = grouped.get(relation.fromPageId) ?? new Set<string>();
    targets.add(relation.toPageId);
    grouped.set(relation.fromPageId, targets);
  }
  return grouped;
}

function relationCandidates(
  values: ReadonlySet<string> | undefined,
  allowed: ReadonlySet<string>,
  pageById: ReadonlyMap<string, LibraryPageSummary>
): readonly string[] {
  return sortPageIds(Array.from(values ?? []).filter((value) => allowed.has(value)), pageById);
}

function createSourcePageLookup(pages: readonly LibraryPageSummary[]): Map<string, LibraryPageSummary> {
  const lookup = new Map<string, LibraryPageSummary>();
  for (const page of pages.filter((candidate) => candidate.pageType === "source").sort(comparePages)) {
    for (const sourceId of page.sourceIds) {
      if (!lookup.has(sourceId)) lookup.set(sourceId, page);
    }
  }
  return lookup;
}

function toPageRef(page: LibraryPageSummary): KnowledgeTreePageRef {
  return {
    pageId: page.pageId,
    pagePath: page.pagePath,
    title: page.title,
    pageType: page.pageType,
    status: page.status,
    sourceIds: Array.from(new Set(page.sourceIds)).sort(compareText)
  };
}

function hasAggregateContent(node: MutableStructuralNode): boolean {
  return node.childIds.size > 0 || node.directPages.size > 0 || node.directSourceRefs.size > 0;
}

function addSourceRefs(target: Set<string>, values: readonly string[]): void {
  for (const value of values) target.add(value);
}

function sortPageIds(
  values: Iterable<string>,
  pageById: ReadonlyMap<string, LibraryPageSummary>
): string[] {
  return Array.from(new Set(values)).sort((left, right) => {
    const leftPage = pageById.get(left);
    const rightPage = pageById.get(right);
    if (leftPage && rightPage) return comparePages(leftPage, rightPage);
    return compareText(left, right);
  });
}

function comparePages(left: LibraryPageSummary, right: LibraryPageSummary): number {
  return compareText(left.title, right.title) || compareText(left.pageId, right.pageId);
}

function compareNodes(left: KnowledgeTreeNode, right: KnowledgeTreeNode): number {
  return nodeKindRank(left.kind) - nodeKindRank(right.kind)
    || compareText(left.title, right.title)
    || compareText(left.id, right.id);
}

function nodeKindRank(kind: KnowledgeTreeNodeKind): number {
  return kind === "domain" ? 0 : kind === "topic" ? 1 : kind === "concept" ? 2 : 3;
}

function compareText(left: string, right: string): number {
  const leftKey = sortKey(left);
  const rightKey = sortKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left < right ? -1 : left > right ? 1 : 0;
}

function sortKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/\s+/gu, " ").trim();
}
