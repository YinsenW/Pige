import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationEventSchema } from "@pige/schemas";

const storage = vi.hoisted(() => ({
  readBundle: vi.fn(),
  readCollectionSnapshot: vi.fn(),
  readImmutableCollectionRevision: vi.fn()
}));

vi.mock("../../apps/desktop/src/main/services/managed-collection-storage", () => storage);

import { ManagedCollectionCitationService } from
  "../../apps/desktop/src/main/services/managed-collection-citation-service";

const activeVaultId = "vault_20260729_datasetcitation";
const vaultPath = "/safe/vault";
const request = {
  apiVersion: 1,
  requestId: "collection_request_citationopen0001",
  activeVaultId,
  conversationId: "conv_20260729_datasetcitation",
  assistantEventId: "evt_20260729_datasetcitation01",
  citationRef: "dataset_citation_1"
} as const;
const preview = {
  datasetId: "dataset_20260729_datasetcitation",
  revisionId: "dataset_rev_20260729_datasetcitation",
  tableId: "table_datasetcitation01",
  tableName: "Regional totals",
  planHash: `sha256:${"a".repeat(64)}`,
  resultHash: `sha256:${"b".repeat(64)}`,
  columns: [
    {
      key: "region",
      label: "Region",
      logicalType: "string",
      sourceColumnId: "column_datasetregion01"
    },
    {
      key: "record_count",
      label: "Records",
      logicalType: "integer",
      sourceColumnId: "column_datasetcount001",
      aggregate: "count"
    }
  ],
  rows: [{ rowId: "row_datasetcitation01", values: ["North", 3] }],
  matchedRowCount: 1,
  returnedRowCount: 1,
  truncated: false,
  citationRefs: [request.citationRef]
} as const;
const citation = {
  kind: "dataset",
  refId: request.citationRef,
  label: "[10]",
  title: "Regional totals",
  locator: "dataset:regional-totals",
  evidence: {
    datasetId: preview.datasetId,
    revisionId: preview.revisionId,
    tableId: preview.tableId,
    schemaId: `sha256:${"c".repeat(64)}`,
    columnIds: ["column_datasetregion01", "column_datasetcount001"],
    rowIds: ["row_datasetcitation01"],
    range: { startRow: 1, endRow: 1 },
    queryPlanHash: preview.planHash,
    resultHash: preview.resultHash,
    sourceId: "src_20260729_datasetcitation",
    sourceRevisionHash: `sha256:${"d".repeat(64)}`
  }
} as const;

beforeEach(() => {
  storage.readBundle.mockReset();
  storage.readCollectionSnapshot.mockReset();
  storage.readImmutableCollectionRevision.mockReset();
});

describe("ManagedCollectionCitationService", () => {
  it("opens the exact immutable cited revision with bounded typed highlights", () => {
    const event = makeEvent();
    const active = {
      manifest: { datasetId: preview.datasetId },
      revision: { id: "dataset_rev_20260729_activecurrent001" }
    };
    const historical = {
      ...active,
      revision: {
        id: preview.revisionId,
        source: { sourceId: citation.evidence.sourceId },
        schema: { checksum: citation.evidence.schemaId }
      },
      schema: {
        tables: [{
          id: preview.tableId,
          columns: citation.evidence.columnIds.map((id) => ({ id }))
        }]
      }
    };
    storage.readBundle.mockReturnValue(active);
    storage.readImmutableCollectionRevision.mockReturnValue(historical);
    storage.readCollectionSnapshot.mockReturnValue({ revisionId: preview.revisionId });
    const lookup = { readAssistantEvent: vi.fn(() => event) };
    const service = new ManagedCollectionCitationService(vaultPort(), lookup);

    expect(service.open(request)).toEqual({
      ...request,
      status: "ready",
      mode: "citation_readonly",
      preview,
      highlights: [
        { kind: "rows", rowIds: citation.evidence.rowIds },
        { kind: "range", range: citation.evidence.range },
        { kind: "columns", columnIds: citation.evidence.columnIds },
        { kind: "aggregate", aggregateKeys: ["record_count"], groupKeys: ["region"] }
      ]
    });
    expect(storage.readImmutableCollectionRevision).toHaveBeenCalledWith(active, preview.revisionId);
    expect(storage.readCollectionSnapshot).toHaveBeenCalledWith(
      historical,
      preview.tableId,
      { rowIds: citation.evidence.rowIds }
    );
    expect(lookup.readAssistantEvent).toHaveBeenCalledWith({
      vaultPath,
      conversationId: request.conversationId,
      assistantEventId: request.assistantEventId
    });
  });

  it("fails closed for unknown refs, durable drift, and a vault change during lookup", () => {
    const lookup = { readAssistantEvent: vi.fn(() => makeEvent()) };
    const unknown = new ManagedCollectionCitationService(vaultPort(), lookup).open({
      ...request,
      citationRef: "dataset_citation_unknown"
    });
    expect(unknown).toMatchObject({ status: "not_found" });
    expect(storage.readBundle).not.toHaveBeenCalled();

    storage.readBundle.mockImplementation(() => {
      throw new Error("historical revision changed");
    });
    expect(new ManagedCollectionCitationService(vaultPort(), lookup).open(request))
      .toMatchObject({ status: "stale" });

    let active = true;
    storage.readBundle.mockImplementation(() => ({ manifest: { datasetId: preview.datasetId } }));
    storage.readImmutableCollectionRevision.mockReturnValue({
      revision: {
        id: preview.revisionId,
        source: { sourceId: citation.evidence.sourceId },
        schema: { checksum: citation.evidence.schemaId }
      },
      schema: {
        tables: [{
          id: preview.tableId,
          columns: citation.evidence.columnIds.map((id) => ({ id }))
        }]
      }
    });
    storage.readCollectionSnapshot.mockImplementation(() => {
      active = false;
      return { revisionId: preview.revisionId };
    });
    expect(new ManagedCollectionCitationService(vaultPort(() => active), lookup).open(request))
      .toMatchObject({ status: "stale" });
  });
});

function makeEvent() {
  return ConversationEventSchema.parse({
    schemaVersion: 1,
    id: request.assistantEventId,
    conversationId: request.conversationId,
    type: "assistant_message",
    createdAt: "2026-07-29T00:00:00.000Z",
    parentEventId: "evt_20260729_datasetcitation00",
    jobId: "job_20260729_datasetcitation01",
    text: "North has three records.",
    answerGrounding: "source",
    answerCitations: [citation],
    answerDatasetResult: preview
  });
}

function vaultPort(isActive: () => boolean = () => true) {
  return {
    current: () => isActive() ? { vaultId: activeVaultId } as never : undefined,
    activeVaultPath: () => isActive() ? vaultPath : undefined
  };
}
