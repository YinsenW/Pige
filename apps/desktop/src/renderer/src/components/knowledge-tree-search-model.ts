export type KnowledgeTreeSearchCandidate = {
  readonly id: string;
  readonly parentId: string | null;
  readonly title: string;
  readonly kind: string;
  readonly kindLabel: string;
  readonly pageId?: string;
  readonly focusKey?: string;
};

export type KnowledgeTreeSearchMatch = KnowledgeTreeSearchCandidate & {
  readonly ancestorIds: readonly string[];
  readonly breadcrumb: readonly string[];
};

const MAX_RESULTS = 20;

export function normalizeKnowledgeTreeQuery(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

export function searchKnowledgeTree(
  candidates: readonly KnowledgeTreeSearchCandidate[],
  query: string
): readonly KnowledgeTreeSearchMatch[] {
  const normalized = normalizeKnowledgeTreeQuery(query);
  if (!normalized) return [];
  const tokens = normalized.split(" ");
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  return candidates.flatMap((candidate): readonly KnowledgeTreeSearchMatch[] => {
    const searchable = normalizeKnowledgeTreeQuery(`${candidate.title} ${candidate.kindLabel} ${candidate.kind}`);
    if (!tokens.every((token) => searchable.includes(token))) return [];
    const ancestorIds: string[] = [];
    const breadcrumb: string[] = [];
    const visited = new Set<string>([candidate.id]);
    let parentId = candidate.parentId;
    while (parentId) {
      if (visited.has(parentId)) return [];
      visited.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      ancestorIds.unshift(parent.id);
      if (parent.parentId) breadcrumb.unshift(parent.title);
      parentId = parent.parentId;
    }
    return [{ ...candidate, ancestorIds, breadcrumb }];
  }).sort((left, right) => {
    const leftTitle = normalizeKnowledgeTreeQuery(left.title);
    const rightTitle = normalizeKnowledgeTreeQuery(right.title);
    const leftRank = leftTitle === normalized ? 0 : leftTitle.startsWith(normalized) ? 1 : 2;
    const rightRank = rightTitle === normalized ? 0 : rightTitle.startsWith(normalized) ? 1 : 2;
    return leftRank - rightRank || leftTitle.localeCompare(rightTitle) || left.id.localeCompare(right.id);
  }).slice(0, MAX_RESULTS);
}
