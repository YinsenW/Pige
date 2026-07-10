import { describe, expect, it } from "vitest";
import {
  ArtifactIdSchema,
  BackupManifestSchema,
  ConversationEventIdSchema,
  JobClassSchema,
  JobRecordSchema,
  JobStateSchema,
  OperationRecordSchema,
  PageIdSchema,
  SourceRecordSchema,
  VaultBindingsFileSchema
} from "@pige/schemas";

const checksum = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const timestamp = "2026-07-10T00:00:00.000Z";

describe("durable contract schemas", () => {
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
