export type KnowledgeTreeDisplayNode = {
  readonly title: string;
  readonly kind: string;
  readonly weight: number;
  readonly fragmentCount: number;
  readonly sourceCount: number;
  readonly leafCount: number;
  readonly status?: string | undefined;
};

export function evidenceDensity(node: Pick<KnowledgeTreeDisplayNode, "fragmentCount" | "sourceCount">): number {
  return node.fragmentCount + node.sourceCount;
}

export function evidenceDensityBand(density: number): 0 | 1 | 2 | 3 {
  if (density <= 0) return 0;
  if (density <= 2) return 1;
  if (density <= 5) return 2;
  return 3;
}

export function searchKindLabel(t: (key: string) => string, node: Pick<KnowledgeTreeDisplayNode, "kind">): string {
  return t(`knowledgeTree.kind.${node.kind === "root" ? "concept" : node.kind}`);
}

export function formatNodeSummary(t: (key: string) => string, node: KnowledgeTreeDisplayNode): string {
  const summary = t("knowledgeTree.nodeSummary")
    .replace("{title}", node.title)
    .replace("{weight}", String(node.weight))
    .replace("{fragments}", String(node.fragmentCount))
    .replace("{sources}", String(node.sourceCount))
    .replace("{leaves}", String(node.leafCount))
    .replace("{density}", String(evidenceDensity(node)));
  return node.status === "needs_review" ? `${summary} ${t("knowledgeTree.needsReview")}.` : summary;
}
