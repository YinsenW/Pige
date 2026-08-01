import type { LibraryPageSummary } from "@pige/contracts";
import type { KnowledgeTreeEntityInput } from "./knowledge-relation-index";

export interface MutableKnowledgeTreeNode {
  readonly id: string;
  readonly title: string;
  readonly kind: "domain" | "topic" | "concept" | "entity";
  readonly page?: LibraryPageSummary;
  readonly synthetic: boolean;
  readonly childIds: Set<string>;
  readonly relatedParentPageIds: Set<string>;
  readonly directPages: Map<string, LibraryPageSummary>;
  readonly directSourceRefs: Set<string>;
}

export function addKnowledgeTreeEntityBranches(
  nodes: Map<string, MutableKnowledgeTreeNode>,
  pages: ReadonlyMap<string, LibraryPageSummary>,
  relations: readonly { readonly fromPageId: string; readonly toPageId: string; readonly relationType: string }[],
  entities: readonly KnowledgeTreeEntityInput[]
): MutableKnowledgeTreeNode | undefined {
  if (entities.length === 0) return undefined;
  const root: MutableKnowledgeTreeNode = {
    id: "knowledge-domain:entities", title: "Entities", kind: "domain", synthetic: true,
    childIds: new Set(), relatedParentPageIds: new Set(), directPages: new Map(), directSourceRefs: new Set()
  };
  nodes.set(root.id, root);
  for (const entity of entities) {
    const page = entity.pageId ? pages.get(entity.pageId) : undefined;
    const node: MutableKnowledgeTreeNode = {
      id: entity.entityId, title: entity.name, kind: "entity", ...(page ? { page } : {}), synthetic: !page,
      childIds: new Set(), relatedParentPageIds: new Set(), directPages: new Map(), directSourceRefs: new Set()
    };
    nodes.set(node.id, node);
    root.childIds.add(node.id);
  }
  for (const relation of relations) {
    if (relation.relationType !== "mentions_entity") continue;
    const page = pages.get(relation.fromPageId);
    const node = nodes.get(relation.toPageId);
    if (!page || !node || node.kind !== "entity" || node.page?.pageId === page.pageId) continue;
    node.directPages.set(page.pageId, page);
    for (const sourceId of page.sourceIds) node.directSourceRefs.add(sourceId);
  }
  return root;
}

export function mergeKnowledgeRelationGroups(
  ...groups: readonly ReadonlyMap<string, ReadonlySet<string>>[]
): Map<string, Set<string>> {
  const merged = new Map<string, Set<string>>();
  for (const group of groups) for (const [source, targets] of group) {
    const values = merged.get(source) ?? new Set<string>();
    for (const target of targets) values.add(target);
    merged.set(source, values);
  }
  return merged;
}
