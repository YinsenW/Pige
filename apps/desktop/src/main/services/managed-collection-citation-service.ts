import type { ConversationEvent } from "@pige/schemas";
import {
  CollectionOpenCitationRequestSchema,
  CollectionOpenCitationResultSchema,
  type CollectionCitationHighlight,
  type CollectionOpenCitationRequest,
  type CollectionOpenCitationResult,
  type DatasetAnswerCitation
} from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";
import { readDurableAgentTurnAnswer } from "./durable-agent-turn-answer";
import {
  readBundle,
  readCollectionSnapshot,
  readImmutableCollectionRevision
} from "./managed-collection-storage";

export interface ManagedCollectionCitationVaultPort {
  current(): VaultSummary | undefined;
  activeVaultPath(): string | undefined;
}

export interface ManagedCollectionCitationLookupPort {
  readAssistantEvent(input: {
    readonly vaultPath: string;
    readonly conversationId: string;
    readonly assistantEventId: string;
  }): ConversationEvent | undefined;
}

export class ManagedCollectionCitationService {
  readonly #vaults: ManagedCollectionCitationVaultPort;
  readonly #lookup: ManagedCollectionCitationLookupPort;

  constructor(
    vaults: ManagedCollectionCitationVaultPort,
    lookup: ManagedCollectionCitationLookupPort
  ) {
    this.#vaults = vaults;
    this.#lookup = lookup;
  }

  open(request: CollectionOpenCitationRequest): CollectionOpenCitationResult {
    const parsed = CollectionOpenCitationRequestSchema.parse(request);
    const identity = resultIdentity(parsed);
    const vaultPath = this.#activeVaultPath(parsed.activeVaultId);
    if (!vaultPath) return CollectionOpenCitationResultSchema.parse({ ...identity, status: "stale" });
    try {
      const event = this.#lookup.readAssistantEvent({
        vaultPath,
        conversationId: parsed.conversationId,
        assistantEventId: parsed.assistantEventId
      });
      if (!event) return CollectionOpenCitationResultSchema.parse({ ...identity, status: "not_found" });
      const answer = readDurableAgentTurnAnswer(event);
      const preview = answer.datasetResult;
      const citations = answer.citations.filter(isDatasetCitation);
      const citation = citations.find(({ refId }) => refId === parsed.citationRef);
      if (!preview || !citation || citations.filter(({ refId }) => refId === parsed.citationRef).length !== 1) {
        return CollectionOpenCitationResultSchema.parse({ ...identity, status: "not_found" });
      }
      if (!citationMatchesPreview(citation, preview)) {
        return CollectionOpenCitationResultSchema.parse({ ...identity, status: "stale" });
      }
      const active = readBundle(vaultPath, citation.evidence.datasetId);
      if (!active) return CollectionOpenCitationResultSchema.parse({ ...identity, status: "not_found" });
      const cited = readImmutableCollectionRevision(active, citation.evidence.revisionId);
      if (!citationMatchesRevision(citation, cited)) {
        return CollectionOpenCitationResultSchema.parse({ ...identity, status: "stale" });
      }
      if (!readCollectionSnapshot(cited, citation.evidence.tableId, {
        rowIds: citation.evidence.rowIds ?? []
      })) {
        return CollectionOpenCitationResultSchema.parse({ ...identity, status: "not_found" });
      }
      if (!this.#activeVaultPath(parsed.activeVaultId)) {
        return CollectionOpenCitationResultSchema.parse({ ...identity, status: "stale" });
      }
      return CollectionOpenCitationResultSchema.parse({
        ...identity,
        status: "ready",
        mode: "citation_readonly",
        preview,
        highlights: createHighlights(citation, preview.columns)
      });
    } catch {
      return CollectionOpenCitationResultSchema.parse({ ...identity, status: "stale" });
    }
  }

  #activeVaultPath(vaultId: string): string | undefined {
    const current = this.#vaults.current();
    const vaultPath = this.#vaults.activeVaultPath();
    return current?.vaultId === vaultId && vaultPath ? vaultPath : undefined;
  }
}

function resultIdentity(request: CollectionOpenCitationRequest) {
  return {
    apiVersion: request.apiVersion,
    requestId: request.requestId,
    activeVaultId: request.activeVaultId,
    conversationId: request.conversationId,
    assistantEventId: request.assistantEventId,
    citationRef: request.citationRef
  } as const;
}

function isDatasetCitation(value: unknown): value is DatasetAnswerCitation {
  return typeof value === "object" && value !== null &&
    "kind" in value && (value as { readonly kind?: unknown }).kind === "dataset";
}

function citationMatchesPreview(
  citation: DatasetAnswerCitation,
  preview: NonNullable<ReturnType<typeof readDurableAgentTurnAnswer>["datasetResult"]>
): boolean {
  const evidence = citation.evidence;
  return preview.citationRefs.includes(citation.refId) &&
    evidence.datasetId === preview.datasetId &&
    evidence.revisionId === preview.revisionId &&
    evidence.tableId === preview.tableId &&
    evidence.queryPlanHash === preview.planHash &&
    evidence.resultHash === preview.resultHash;
}

function citationMatchesRevision(
  citation: DatasetAnswerCitation,
  revision: ReturnType<typeof readImmutableCollectionRevision>
): boolean {
  const table = revision.schema.tables.find(({ id }) => id === citation.evidence.tableId);
  const columnIds = new Set(table?.columns.map(({ id }) => id) ?? []);
  return revision.revision.id === citation.evidence.revisionId &&
    revision.revision.source.sourceId === citation.evidence.sourceId &&
    revision.revision.schema.checksum === citation.evidence.schemaId &&
    citation.evidence.columnIds.every((columnId) => columnIds.has(columnId));
}

function createHighlights(
  citation: DatasetAnswerCitation,
  columns: NonNullable<ReturnType<typeof readDurableAgentTurnAnswer>["datasetResult"]>["columns"]
): CollectionCitationHighlight[] {
  const highlights: CollectionCitationHighlight[] = [];
  if (citation.evidence.rowIds) highlights.push({ kind: "rows", rowIds: citation.evidence.rowIds });
  if (citation.evidence.range) highlights.push({ kind: "range", range: citation.evidence.range });
  highlights.push({ kind: "columns", columnIds: citation.evidence.columnIds });
  const aggregateKeys = columns.flatMap((column) => column.aggregate ? [column.key] : []);
  if (aggregateKeys.length > 0) {
    highlights.push({
      kind: "aggregate",
      aggregateKeys,
      groupKeys: columns.flatMap((column) => column.aggregate ? [] : [column.key])
    });
  }
  return highlights;
}
