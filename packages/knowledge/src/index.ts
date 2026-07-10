export const KNOWLEDGE_NODE_KINDS = ["topic", "concept", "entity", "claim", "source"] as const;

export type KnowledgeNodeKind = (typeof KNOWLEDGE_NODE_KINDS)[number];

export interface KnowledgeTreeWeight {
  readonly noteCount: number;
  readonly chunkCount: number;
  readonly confidence: number;
}
