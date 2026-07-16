import { describe, expect, it } from "vitest";
import {
  ArtifactIdSchema,
  BackupManifestSchema,
  ConversationEventSchema,
  ConversationEventIdSchema,
  CurrentSourceRecordSchema,
  DatasetAnswerCitationSchema,
  DatasetEvidenceRefSchema,
  DatasetManifestSchema,
  DatasetQueryPreviewSchema,
  DatasetQueryScalarSchema,
  DatasetRevisionSchema,
  DatasetSchemaRecordSchema,
  JobClassSchema,
  JobRecordSchema,
  JobStateSchema,
  OperationRecordSchema,
  PageIdSchema,
  SourceRecordSchema,
  VaultBindingsFileSchema
} from "@pige/schemas";

const checksum = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const planHash = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const resultHash = "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const sourceRevisionHash = "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const timestamp = "2026-07-10T00:00:00.000Z";

function datasetAnswerFixture() {
  const evidence = {
    datasetId: "dataset_20260713_abcdef123456",
    revisionId: "dataset_rev_20260713_abcdef123456",
    tableId: "table_abcdef123456",
    schemaId: checksum,
    columnIds: ["column_abcdef123456", "column_bcdefa123456"],
    rowIds: ["row_abcdef123456"],
    range: { startRow: 1, endRow: 1 },
    queryPlanHash: planHash,
    resultHash,
    sourceId: "src_20260713_abcdef12",
    sourceRevisionHash
  };
  const citation = {
    kind: "dataset" as const,
    refId: "dataset_citation_1",
    label: "[D1]",
    title: "Regional totals",
    locator: "dataset:regional-totals#rows:1",
    evidence
  };
  const preview = {
    datasetId: evidence.datasetId,
    revisionId: evidence.revisionId,
    tableId: evidence.tableId,
    tableName: "Regional totals",
    planHash,
    resultHash,
    columns: [
      {
        key: "region",
        label: "Region",
        logicalType: "string" as const,
        sourceColumnId: evidence.columnIds[0]
      },
      {
        key: "record_count",
        label: "Records",
        logicalType: "integer" as const,
        sourceColumnId: evidence.columnIds[1],
        aggregate: "count"
      }
    ],
    rows: [{ rowId: evidence.rowIds[0], values: ["North", 3] }],
    matchedRowCount: 1,
    returnedRowCount: 1,
    truncated: false,
    citationRefs: [citation.refId]
  };
  return { citation, evidence, preview };
}

describe("durable contract schemas", () => {
  it("makes current SourceRecord orchestration explicit while normalizing historical records", () => {
    const common = {
      id: "src_20260710_abcdef12",
      kind: "text" as const,
      storageStrategy: "reference_original" as const,
      original: { uri: "pige:text:src_20260710_abcdef12" },
      artifacts: [],
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(SourceRecordSchema.parse(common).semanticOrchestration).toBe("legacy_agent_ingest");
    expect(CurrentSourceRecordSchema.parse({
      ...common,
      semanticOrchestration: "agent_turn"
    }).semanticOrchestration).toBe("agent_turn");
    expect(() => CurrentSourceRecordSchema.parse(common)).toThrow();
    expect(() => CurrentSourceRecordSchema.parse({
      ...common,
      semanticOrchestration: "legacy_agent_ingest"
    })).toThrow();
    expect(() => SourceRecordSchema.parse({
      ...common,
      semanticOrchestration: "unknown"
    })).toThrow();
  });

  it("uses one stable ID vocabulary and rejects retired aliases", () => {
    expect(PageIdSchema.parse("page_20260710_abcdef12")).toBe("page_20260710_abcdef12");
    expect(ConversationEventIdSchema.parse("evt_20260710_abcdef12")).toBe("evt_20260710_abcdef12");
    expect(ArtifactIdSchema.parse("art_20260710_abcdef12_text")).toBe("art_20260710_abcdef12_text");

    expect(() => PageIdSchema.parse("pg_20260710_abcdef12")).toThrow();
    expect(() => ConversationEventIdSchema.parse("event_20260710_abcdef12")).toThrow();
    expect(() => ArtifactIdSchema.parse("artifact_20260710_abcdef12")).toThrow();
  });

  it("accepts legacy source-derived artifact IDs only through source-record compatibility", () => {
    const sourceRecord = SourceRecordSchema.parse({
      id: "src_20260710_abcdef12",
      kind: "url",
      storageStrategy: "copy_to_source_library",
      managedCopy: {
        rootId: "root_external01",
        pathBasis: "root_relative",
        path: "web/src_20260710_abcdef12.html",
        checksum,
        size: 42
      },
      artifacts: [{
        id: "src_20260710_abcdef12_text",
        kind: "extracted_text",
        path: "artifacts/web/src_20260710_abcdef12.txt",
        checksum,
        size: 12
      }],
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(sourceRecord.schemaVersion).toBe(1);
    expect(sourceRecord.managedCopy?.rootId).toBe("root_external01");
    expect(() => ArtifactIdSchema.parse(sourceRecord.artifacts[0]?.id)).toThrow();
  });

  it("keeps external managed-copy roots in a stable machine-local registry", () => {
    const bindings = VaultBindingsFileSchema.parse({
      schemaVersion: 1,
      roots: [{
        rootId: "root_external01",
        vaultId: "vault_20260710_abcdef12",
        purpose: "managed_copy",
        absolutePath: "/Volumes/Knowledge Sources",
        availability: "available",
        createdAt: timestamp,
        updatedAt: timestamp
      }],
      defaults: [{ vaultId: "vault_20260710_abcdef12", rootId: "root_external01" }]
    });

    expect(bindings.roots[0]?.rootId).toBe("root_external01");
    expect(bindings.roots[0]?.absolutePath).toBe("/Volumes/Knowledge Sources");
    expect(bindings.defaults[0]?.rootId).toBe("root_external01");
    expect(() => VaultBindingsFileSchema.parse({
      schemaVersion: 1,
      roots: bindings.roots,
      defaults: [{ vaultId: "vault_20260710_other123", rootId: "root_external01" }]
    })).toThrow("same vault");
    expect(() => VaultBindingsFileSchema.parse({
      schemaVersion: 1,
      roots: [bindings.roots[0], { ...bindings.roots[0], absolutePath: "/Volumes/Other Sources" }],
      defaults: []
    })).toThrow("root ID must be unique");
  });

  it("keeps in-vault and external managed-copy locator semantics unambiguous", () => {
    const common = {
      id: "src_20260710_abcdef12",
      kind: "pdf_file" as const,
      storageStrategy: "copy_to_source_library" as const,
      artifacts: [],
      metadata: {},
      createdAt: timestamp,
      updatedAt: timestamp
    };

    expect(SourceRecordSchema.parse({
      ...common,
      managedCopy: {
        rootId: "root_vault_managed",
        pathBasis: "vault_relative",
        path: "raw/files/source.pdf",
        checksum,
        size: 42
      }
    }).managedCopy?.pathBasis).toBe("vault_relative");
    expect(SourceRecordSchema.parse({
      ...common,
      managedCopy: {
        rootId: "root_external01",
        pathBasis: "root_relative",
        path: "files/source.pdf",
        checksum,
        size: 42
      }
    }).managedCopy?.pathBasis).toBe("root_relative");
    expect(() => SourceRecordSchema.parse({
      ...common,
      managedCopy: {
        rootId: "root_external01",
        pathBasis: "vault_relative",
        path: "raw/files/source.pdf",
        checksum,
        size: 42
      }
    })).toThrow("external managed-copy root must use a root_relative");
    expect(() => SourceRecordSchema.parse({
      ...common,
      managedCopy: {
        rootId: "root_vault_managed",
        pathBasis: "root_relative",
        path: "files/source.pdf",
        checksum,
        size: 42
      }
    })).toThrow("in-vault managed-copy root must use a vault_relative");
    expect(() => SourceRecordSchema.parse({
      ...common,
      storageStrategy: "reference_original",
      original: {
        uri: "file:///Users/example/source.pdf",
        path: "/Users/example/source.pdf",
        checksum,
        lastKnownSize: 42
      },
      managedCopy: {
        rootId: "root_vault_managed",
        pathBasis: "vault_relative",
        path: "raw/files/source.pdf",
        checksum,
        size: 42
      }
    })).toThrow("must not contain a managedCopy locator");
  });

  it("keeps job class, state, and record fields on the shared executable contract", () => {
    expect(JobClassSchema.parse("capture_batch")).toBe("capture_batch");
    expect(JobStateSchema.parse("waiting_dependency")).toBe("waiting_dependency");
    expect(JobStateSchema.parse("waiting_model_egress")).toBe("waiting_model_egress");

    const record = JobRecordSchema.parse({
      id: "job_20260710_abcdef12",
      class: "capture_batch",
      state: "waiting_dependency",
      childJobIds: ["job_20260710_abcdef13"],
      createdAt: timestamp,
      updatedAt: timestamp,
      policyContextId: "policy_20260710_abcdef12",
      policyHash: checksum,
      checkpoints: [{
        id: "checkpoint_preflight",
        step: "preflight",
        state: "done",
        inputRefs: [],
        outputRefs: [{ kind: "backup", id: "backup_20260710_abcdef12", checksum }],
        checksumAfter: checksum
      }],
      message: "Waiting for an external managed-copy root."
    });

    expect(record.schemaVersion).toBe(1);
    expect(record.state).toBe("waiting_dependency");
    expect(record.childJobIds).toEqual(["job_20260710_abcdef13"]);
    expect(record.checkpoints?.[0]?.state).toBe("done");
    expect(() => JobRecordSchema.parse({ ...record, state: undefined, status: "queued" })).toThrow();
    expect(() => JobRecordSchema.parse({ ...record, status: "completed" })).toThrow("Unrecognized key");
    expect(() => JobRecordSchema.parse({ ...record, undocumentedLifecycleFlag: true })).toThrow("Unrecognized key");
    expect(() => JobRecordSchema.parse({
      ...record,
      permissionRequestIds: ["perm_20260710_abcdef12"]
    })).toThrow();
    expect(() => JobRecordSchema.parse({
      ...record,
      privacy: {
        usedCloudModel: false,
        usedNetwork: false,
        usedShell: false,
        accessedExternalFiles: false,
        permissionDecisionIds: ["perm_20260710_abcdef12"]
      }
    })).toThrow();
  });

  it("binds Dataset manifests, revisions, schemas, and payloads to stable durable identities", () => {
    const datasetId = "dataset_20260713_abcdef123456";
    const revisionId = "dataset_rev_20260713_abcdef123456";
    const fileRef = { path: "schemas/revision.json", checksum, size: 128 };
    const schema = DatasetSchemaRecordSchema.parse({
      schemaVersion: 1,
      datasetId,
      revisionId,
      tables: [{
        id: "table_abcdef123456",
        name: "records",
        sourceLocator: "csv:records",
        ordinal: 0,
        rowCount: 2,
        columnCount: 1,
        columns: [{
          id: "column_abcdef123456",
          name: "value",
          ordinal: 0,
          sourceType: "csv_text",
          logicalType: "string",
          nullable: false
        }]
      }],
      createdAt: timestamp
    });
    const revision = DatasetRevisionSchema.parse({
      schemaVersion: 1,
      id: revisionId,
      datasetId,
      parentRevisionId: null,
      source: {
        sourceId: "src_20260713_abcdef12",
        sourceKind: "csv_file",
        sourceRecordHash: checksum,
        sourceAssetChecksum: checksum,
        sourceAssetSize: 42
      },
      schema: fileRef,
      payload: { path: "data/collection.sqlite", checksum, size: 256, format: "sqlite" },
      adapter: { id: "pige.csv", version: "1" },
      writer: { id: "pige.managed-collection", version: "1" },
      stats: { tableCount: 1, rowCount: 2, columnCount: 1, cellCount: 2, retainedValueBytes: 8 },
      warnings: [],
      operationId: "op_20260713_abcdef12",
      createdAt: timestamp
    });
    const manifest = DatasetManifestSchema.parse({
      format: "pige-dataset",
      formatVersion: 1,
      datasetId,
      profile: "managed_collection",
      title: "Records",
      sourceId: revision.source.sourceId,
      activeRevision: revisionId,
      revision: { ...fileRef, path: "revisions/revision.json" },
      schema: fileRef,
      payload: revision.payload,
      compatibility: { minReaderFormatVersion: 1, maxReaderFormatVersion: 1 },
      createdAt: timestamp,
      updatedAt: timestamp
    });

    expect(schema.tables[0]?.rowCount).toBe(2);
    expect(revision.source.sourceKind).toBe("csv_file");
    expect(manifest.activeRevision).toBe(revisionId);
    expect(() => DatasetSchemaRecordSchema.parse({
      ...schema,
      tables: [{ ...schema.tables[0], columnCount: 2 }]
    })).toThrow("columnCount");
    expect(() => DatasetRevisionSchema.parse({
      ...revision,
      source: { ...revision.source, sourceKind: "pdf_file" }
    })).toThrow();
  });

  it("keeps legacy page citations readable while accepting bounded Dataset citations and previews", () => {
    const legacy = ConversationEventSchema.parse({
      id: "evt_20260713_legacypage01",
      conversationId: "conv_20260713_legacy",
      type: "assistant_message",
      createdAt: timestamp,
      text: "Legacy page-grounded answer.",
      answerGrounding: "local_knowledge",
      answerCitations: [{
        refId: "citation_1",
        label: "[1]",
        pageId: "page_20260713_abcdef12",
        title: "Legacy page",
        pageType: "note",
        locator: "snippet:1"
      }]
    });
    const { citation, preview } = datasetAnswerFixture();
    const dataset = ConversationEventSchema.parse({
      id: "evt_20260713_datasetanswer1",
      conversationId: "conv_20260713_dataset",
      type: "assistant_message",
      createdAt: timestamp,
      text: "North has three records.",
      answerGrounding: "local_knowledge",
      answerCitations: [citation],
      answerDatasetResult: preview
    });

    expect(legacy.schemaVersion).toBe(1);
    expect(legacy.answerCitations?.[0]).not.toHaveProperty("kind");
    expect(dataset.schemaVersion).toBe(1);
    expect(DatasetAnswerCitationSchema.parse(citation)).toEqual(citation);
    expect(dataset.answerCitations?.[0]).toEqual(citation);
    expect(dataset.answerDatasetResult).toEqual(preview);
  });

  it("accepts only a strict current-note scope on durable conversation events", () => {
    const event = ConversationEventSchema.parse({
      id: "evt_20260716_currentscope",
      conversationId: "conv_20260716_scope",
      type: "user_message",
      createdAt: timestamp,
      text: "Read this note.",
      scope: { kind: "current_note", pageId: "page_20260716_scopepage" }
    });

    expect(event.scope).toEqual({ kind: "current_note", pageId: "page_20260716_scopepage" });
    expect(() => ConversationEventSchema.parse({
      ...event,
      scope: { kind: "current_note", pageId: "invalid", path: "/private/note.md" }
    })).toThrow();
  });

  it("rejects non-finite or oversized Dataset query values and unbounded preview shapes", () => {
    const { preview } = datasetAnswerFixture();

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => DatasetQueryScalarSchema.parse(value)).toThrow();
    }
    expect(() => DatasetQueryScalarSchema.parse("x".repeat(4097))).toThrow();
    expect(() => DatasetQueryScalarSchema.parse("😀".repeat(2048))).toThrow("UTF-8 bytes");
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      matchedRowCount: Number.POSITIVE_INFINITY
    })).toThrow();
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      columns: Array.from({ length: 33 }, (_, index) => ({
        key: `column_${index}`,
        label: `Column ${index}`,
        logicalType: "string"
      })),
      rows: [] as const,
      matchedRowCount: 0,
      returnedRowCount: 0,
      truncated: false
    })).toThrow();
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      rows: Array.from({ length: 51 }, (_, index) => ({
        rowId: `row_${String(index).padStart(12, "0")}`,
        values: ["North", index]
      })),
      matchedRowCount: 51,
      returnedRowCount: 51
    })).toThrow();
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      rows: Array.from({ length: 20 }, (_, index) => ({
        rowId: `row_${String(index).padStart(12, "0")}`,
        values: ["x".repeat(2000), "y".repeat(2000)]
      })),
      matchedRowCount: 20,
      returnedRowCount: 20
    })).toThrow("65536 UTF-8 bytes");
    expect(() => DatasetQueryPreviewSchema.parse({ ...preview, rawSql: "SELECT * FROM records" })).toThrow(
      "Unrecognized key"
    );
  });

  it("rejects malformed Dataset identity, hashes, row widths, counts, and citation bindings", () => {
    const { citation, evidence, preview } = datasetAnswerFixture();
    expect(() => DatasetEvidenceRefSchema.parse({ ...evidence, datasetId: "dataset_invalid" })).toThrow();
    expect(() => DatasetEvidenceRefSchema.parse({
      ...evidence,
      datasetId: `dataset_20260713_${"a".repeat(200)}`
    })).toThrow();
    expect(() => DatasetEvidenceRefSchema.parse({ ...evidence, schemaId: "schema_without_checksum" })).toThrow();
    expect(() => DatasetEvidenceRefSchema.parse({ ...evidence, queryPlanHash: "sha256:not-a-hash" })).toThrow();
    expect(() => DatasetEvidenceRefSchema.parse({
      ...evidence,
      columnIds: Array.from(
        { length: 25 },
        (_, index) => `column_${String(index).padStart(12, "0")}`
      )
    })).toThrow();
    expect(() => DatasetEvidenceRefSchema.parse({
      ...evidence,
      range: { startRow: 2, endRow: 1 }
    })).toThrow("endRow");
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      rows: [{ ...preview.rows[0], values: ["North"] }]
    })).toThrow("row width");
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      returnedRowCount: 0
    })).toThrow("returnedRowCount");
    expect(() => DatasetQueryPreviewSchema.parse({
      ...preview,
      matchedRowCount: 1,
      returnedRowCount: 1,
      truncated: true
    })).toThrow("truncation");
    expect(() => ConversationEventSchema.parse({
      id: "evt_20260713_datasetbadref",
      conversationId: "conv_20260713_dataset",
      type: "assistant_message",
      createdAt: timestamp,
      text: "Mismatched Dataset citation ref.",
      answerGrounding: "local_knowledge",
      answerCitations: [citation],
      answerDatasetResult: { ...preview, citationRefs: ["dataset_citation_2"] }
    })).toThrow("citation refs");
    expect(() => ConversationEventSchema.parse({
      id: "evt_20260713_datasetbadhash",
      conversationId: "conv_20260713_dataset",
      type: "assistant_message",
      createdAt: timestamp,
      text: "Mismatched Dataset result hash.",
      answerGrounding: "local_knowledge",
      answerCitations: [{
        ...citation,
        evidence: { ...evidence, resultHash: sourceRevisionHash }
      }],
      answerDatasetResult: preview
    })).toThrow("match the persisted preview");
  });

  it("pairs cancellation request identity while allowing a durable safety fact without a request", () => {
    const base = {
      id: "job_20260710_cancel12",
      class: "ocr" as const,
      state: "failed_retryable" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
      message: "Durable output remains retryable."
    };

    expect(JobRecordSchema.parse({
      ...base,
      cancellation: {
        safeCheckpointId: "pdf_pages_staging_started",
        durableWritesApplied: true
      }
    }).cancellation).toEqual({
      safeCheckpointId: "pdf_pages_staging_started",
      durableWritesApplied: true
    });
    expect(JobRecordSchema.parse({
      ...base,
      cancellation: { requestedAt: timestamp, requestedBy: "user", durableWritesApplied: false }
    }).cancellation?.requestedBy).toBe("user");
    expect(() => JobRecordSchema.parse({
      ...base,
      cancellation: { requestedAt: timestamp, durableWritesApplied: true }
    })).toThrow("must both be present or both be absent");
    expect(() => JobRecordSchema.parse({
      ...base,
      cancellation: { requestedBy: "system", durableWritesApplied: true }
    })).toThrow("must both be present or both be absent");
    expect(JobRecordSchema.parse({
      ...base,
      state: "cancelled",
      cancellation: { durableWritesApplied: false }
    }).state).toBe("cancelled");
    expect(JobRecordSchema.parse({ ...base, state: "cancelled" }).state).toBe("cancelled");
    expect(() => JobRecordSchema.parse({
      ...base,
      state: "cancelled",
      cancellation: { durableWritesApplied: true }
    })).toThrow("cannot have durableWritesApplied set to true");
    expect(() => JobRecordSchema.parse({
      ...base,
      state: "cancel_requested"
    })).toThrow("must include requestedAt and requestedBy");
    expect(() => JobRecordSchema.parse({
      ...base,
      state: "cancel_requested",
      cancellation: { durableWritesApplied: true }
    })).toThrow("must include requestedAt and requestedBy");
    expect(JobRecordSchema.parse({
      ...base,
      state: "cancel_requested",
      cancellation: { requestedAt: timestamp, requestedBy: "user", durableWritesApplied: true }
    }).state).toBe("cancel_requested");
  });

  it("records lifecycle operations with policy-audit evidence", () => {
    const operation = OperationRecordSchema.parse({
      id: "op_20260710_abcdef12",
      schemaVersion: 1,
      jobId: "job_20260710_abcdef12",
      createdAt: timestamp,
      actor: {
        kind: "pige_agent",
        runtimeKind: "desktop_local",
        clientCapabilityTier: "desktop_full"
      },
      permissionDecisionIds: ["permdec_20260710_abcdef12"],
      policyAudit: {
        policyContextId: "policy_20260710_abcdef12",
        policyHash: checksum,
        enforcementOwners: ["Source Storage Service", "Permission Broker"]
      },
      kind: "relink_source",
      targetRefs: [{ kind: "source", id: "src_20260710_abcdef12" }],
      sourceRefs: [],
      summary: "Relinked a missing external source after explicit approval.",
      reversible: "best_effort",
      warnings: []
    });

    expect(operation.kind).toBe("relink_source");
    expect(operation.policyAudit?.enforcementOwners).toContain("Permission Broker");
    expect(() => OperationRecordSchema.parse({
      ...operation,
      permissionDecisionIds: ["perm_20260710_abcdef12"]
    })).toThrow();
    expect(() => OperationRecordSchema.parse({
      ...operation,
      rawPrompt: "PRIVATE PROMPT"
    })).toThrow("Unrecognized key");
  });

  it("requires typed body-free audit identity for model-egress operations", () => {
    const audit = {
      payloadHash: checksum,
      evidenceSummaryHash: `sha256:${"b".repeat(64)}`,
      decisionHash: `sha256:${"c".repeat(64)}`,
      payloadCharacters: 42,
      estimatedPayloadTokens: 11,
      normalPayloadCharacterLimit: 18_000,
      contentClasses: ["ordinary"] as const,
      outcome: "allow" as const,
      reasonCode: "ordinary_external_allowed" as const
    };
    const operation = {
      id: "op_20260710_abcdef13",
      schemaVersion: 1 as const,
      jobId: "job_20260710_abcdef12",
      createdAt: timestamp,
      actor: {
        kind: "pige_agent" as const,
        runtimeKind: "desktop_local" as const,
        clientCapabilityTier: "desktop_full" as const
      },
      modelProfileId: "model_example",
      permissionDecisionIds: [],
      policyAudit: {
        policyContextId: "policy_20260710_abcdef12",
        policyHash: checksum,
        enforcementOwners: ["Model Egress Policy"]
      },
      kind: "model_egress_decision" as const,
      targetRefs: [{ kind: "model" as const, id: "model_example" }],
      sourceRefs: [{ kind: "job" as const, id: "job_20260710_abcdef12" }],
      summary: "Allowed ordinary selected evidence.",
      reversible: "no" as const,
      warnings: []
    };

    expect(OperationRecordSchema.parse({ ...operation, modelEgressAudit: audit }).modelEgressAudit)
      .toMatchObject({ payloadHash: checksum, outcome: "allow" });
    expect(() => OperationRecordSchema.parse(operation)).toThrow("requires a typed payload and evidence audit summary");
    expect(() => OperationRecordSchema.parse({ ...operation, modelEgressAudit: { ...audit, rawPrompt: "secret" } }))
      .toThrow("Unrecognized key");
  });

  it("validates backup domain ranges and structured external dependencies", () => {
    const range = { min: 1, max: 1 };
    const manifest = BackupManifestSchema.parse({
      format: "pige-backup",
      formatVersion: 1,
      backupId: "backup_20260710_abcdef12",
      appVersion: "0.1.0",
      vaultId: "vault_20260710_abcdef12",
      vaultName: "Pige Vault",
      vaultSchemaVersion: 1,
      createdAt: timestamp,
      fileCount: 1,
      totalBytes: 42,
      noteCount: 0,
      sourceCount: 1,
      conversationCount: 0,
      memoryCount: 0,
      includesSecrets: false,
      includes: {
        markdownKnowledge: true,
        sourceRecords: true,
        managedSourceCopies: true,
        conversations: true,
        vaultMemory: true,
        trash: true,
        rebuildableDatabaseCache: false,
        secrets: false
      },
      domainSchemaVersions: {
        markdownPages: range,
        sourceRecords: range,
        conversationEvents: range,
        jobs: range,
        proposals: range,
        operations: range,
        memory: range,
        skills: range
      },
      excludedRoots: [".pige/db"],
      externalDependencies: [{
        kind: "external_managed_copy_root",
        rootId: "root_external01",
        included: false,
        requiredForCompleteRestore: true,
        displayName: "External managed source library"
      }],
      files: [{ path: ".pige/manifest.json", size: 42, checksum }]
    });

    expect(manifest.domainSchemaVersions?.sourceRecords).toEqual(range);
    expect(manifest.externalDependencies[0]).toMatchObject({ rootId: "root_external01" });
    expect(() => BackupManifestSchema.parse({
      ...manifest,
      domainSchemaVersions: { ...manifest.domainSchemaVersions, jobs: { min: 2, max: 1 } }
    })).toThrow();
  });
});
