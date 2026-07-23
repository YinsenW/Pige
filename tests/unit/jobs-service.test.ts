import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentIngestService,
  AgentToolDependencyWaitingError,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService, type SourceFetchPort } from "../../apps/desktop/src/main/services/capture-service";
import { DocumentParserService, type DocumentParserPort } from "../../apps/desktop/src/main/services/document-parser-service";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import type { LocalDatabaseRebuildPort } from "../../apps/desktop/src/main/services/local-database-rebuild-types";
import {
  LocalDatabaseService,
  NodeSqliteDriver
} from "../../apps/desktop/src/main/services/local-database-service";
import type { OfficeMediaMaterializerPort } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { extractOfficeText } from "../../apps/desktop/src/main/services/office-parser-core";
import { OfficeParserService } from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_MEDIA_MATERIALIZER_ID,
  OFFICE_MEDIA_MATERIALIZER_VERSION,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  type OfficeMediaTarget
} from "../../apps/desktop/src/main/services/office-parser-types";
import { extractPdfText } from "../../apps/desktop/src/main/services/pdf-parser-core";
import { PdfParserService } from "../../apps/desktop/src/main/services/pdf-parser-service";
import type { PdfPageRendererPort } from "../../apps/desktop/src/main/services/pdf-page-renderer-service";
import {
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_VERSION,
  type PdfPageRendererResult
} from "../../apps/desktop/src/main/services/pdf-page-renderer-types";
import {
  OcrService,
  type NativeImageOcrAdapterPort,
  type OcrPort
} from "../../apps/desktop/src/main/services/ocr-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import type { PiAgentRunRequest, PiAgentRunResult } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { ScriptedAgentIngestRuntime } from "../helpers/scripted-agent-ingest-runtime";
import {
  createVaultOnDisk,
  loadVaultSummary,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import { createTestDocx, createTestPptx, TINY_PNG } from "./helpers/office-fixture";
import { createTestPdf } from "./helpers/pdf-fixture";
import { createJpegScanPdf } from "./helpers/pdf-image-fixture";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-jobs-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Jobs",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Jobs");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_test",
    displayName: "Test Provider",
    providerKind: "openai",
    authSecretRef: "provider_secret_test",
    modelListStrategy: "manual",
    cloudBoundary: "cloud",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  },
  model: {
    id: "model_test",
    providerProfileId: "provider_test",
    modelId: "test-model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  },
  apiKey: "sk-runtime-secret"
};

function makeModelPort(
  getConfig: () => ModelProviderRuntimeConfig | undefined = () => runtimeConfig
): AgentIngestModelConfigPort {
  return {
    getDefaultModel: () => {
      const config = getConfig();
      return config ? { ...config.model, isDefault: true } : undefined;
    },
    getDefaultProvider: () => getConfig()?.provider,
    hasDefaultRuntimeBinding: () => getConfig() !== undefined,
    getDefaultRuntimeConfig: getConfig
  };
}

function makeServices(
  vaultPath: string,
  vault: VaultSummary,
  agentIngest?: AgentIngestService,
  database?: LocalDatabaseService,
  sourceFetch?: SourceFetchPort,
  documentParser?: DocumentParserPort,
  ocr?: OcrPort
): { capture: LegacyCaptureFixture; jobs: JobsService } {
  const vaultPort = {
    current: () => vault,
    activeVaultPath: () => vaultPath
  };
  return {
    capture: new LegacyCaptureFixture(vaultPort, vaultPath, sourceFetch),
    jobs: new JobsService(vaultPort, agentIngest, database, documentParser, ocr)
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("jobs service", () => {
  it("lists queued capture jobs with safe source summaries", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const sourcePath = path.join(path.dirname(vaultPath), "drop.md");
    fs.writeFileSync(sourcePath, "# Drop\n\nCaptured from disk.", "utf8");
    capture.submitText({
      text: "Remember this small idea.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    const result = jobs.list({ limit: 10, classes: ["capture"], states: ["queued"] });

    expect(result.activeVaultId).toBe(vault.vaultId);
    expect(result.invalidJobCount).toBe(0);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs.map((job) => job.state)).toEqual(["queued", "queued"]);
    expect(result.jobs.some((job) => job.sourceDisplayName === "drop.md")).toBe(true);
    expect(JSON.stringify(result.jobs)).not.toContain(sourcePath);
    expect(JSON.stringify(result.jobs)).not.toContain("raw/files");
  });

  it("keeps new text, URL, and file captures out of the legacy Agent ingest lane across restart", async () => {
    const { vaultPath, vault } = makeVault();
    const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
    const capture = new CaptureService(vaultPort, {
      fetchSnapshot: async () => ({
        originalUrl: "https://example.com/current",
        finalUrl: "https://example.com/current",
        contentType: "text/html",
        title: "Current source",
        rawContent: "<p>Current URL source</p>",
        extractedText: "Current URL source",
        warnings: []
      })
    });
    const jobs = new JobsService(vaultPort);
    const filePath = path.join(path.dirname(vaultPath), "current.md");
    fs.writeFileSync(filePath, "# Current file\n", "utf8");
    const url = "https://example.com/current";
    await capture.preserveUrlForAgentTurn({
      url: "https://example.com/current",
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: "en"
    }, {
      jobId: "job_20260722_currenturl01",
      sourceId: "src_20260722_currenturl01",
      inputHash: `sha256:${createHash("sha256").update(url, "utf8").digest("hex")}`
    });
    await capture.preserveFilesForAgentTurn({
      filePaths: [filePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, {
      jobId: "job_20260722_currentfile01",
      sourceId: "src_20260722_currentfile01"
    });

    expect(jobs.processQueuedCaptures()).toMatchObject({ processed: 0, completed: 0, failed: 0 });
    expect(jobs.list({ classes: ["capture"] }).jobs).toEqual([]);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
    const restartedJobs = new JobsService(vaultPort);
    expect(restartedJobs.processQueuedCaptures()).toMatchObject({ processed: 0, completed: 0, failed: 0 });
    expect(restartedJobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("counts invalid job records without failing the whole list", () => {
    const { vaultPath, vault } = makeVault();
    const { jobs } = makeServices(vaultPath, vault);
    const invalidPath = path.join(vaultPath, ".pige", "jobs", "2026", "07", "broken.json");
    fs.mkdirSync(path.dirname(invalidPath), { recursive: true });
    fs.writeFileSync(invalidPath, "{not json", "utf8");

    const result = jobs.list();

    expect(result.invalidJobCount).toBe(1);
    expect(result.jobs).toHaveLength(0);
  });

  it("projects user and rollback Backup ownership with only typed safe errors", () => {
    const { vaultPath, vault } = makeVault();
    const { jobs } = makeServices(vaultPath, vault);
    const jobsPath = path.join(vaultPath, ".pige", "jobs", "2026", "07");
    fs.mkdirSync(jobsPath, { recursive: true });
    const records = [
      {
        id: "job_20260710_backupuser1",
        inputRefs: [{ kind: "external_uri", path: "/private/hidden-user-backup.zip", role: "backup_destination" }],
        error: {
          code: "backup.destination_changed",
          domain: "backup",
          messageKey: "errors.backup.destination_changed",
          retryable: false,
          severity: "error",
          userAction: "choose_path"
        }
      },
      {
        id: "job_20260710_backuproll1",
        inputRefs: [{ kind: "external_uri", path: "/private/hidden-rollback.zip", role: "rollback_backup_destination" }]
      }
    ] as const;
    for (const record of records) {
      fs.writeFileSync(path.join(jobsPath, `${record.id}.json`), `${JSON.stringify({
        schemaVersion: 1,
        class: "backup",
        state: record.error ? "failed_final" : "running",
        stage: "backing_up",
        priority: "interactive",
        scope: "vault",
        createdAt: "2026-07-10T01:00:00.000Z",
        updatedAt: "2026-07-10T01:01:00.000Z",
        activeVaultId: vault.vaultId,
        inputRefs: record.inputRefs,
        outputRefs: [],
        checkpoints: [],
        ...(record.error ? { error: record.error } : {}),
        message: "Internal Backup message with /private/hidden details.",
        id: record.id
      }, null, 2)}\n`, "utf8");
    }

    const summaries = jobs.list({ classes: ["backup"], limit: 10 }).jobs;

    expect(new Map(summaries.map((job) => [job.id, job.backupKind]))).toEqual(new Map([
      ["job_20260710_backupuser1", "user_backup"],
      ["job_20260710_backuproll1", "restore_rollback"]
    ]));
    expect(summaries.find((job) => job.id === "job_20260710_backupuser1")?.error).toEqual(expect.objectContaining({
      code: "backup.destination_changed",
      userAction: "choose_path"
    }));
    expect(JSON.stringify(summaries)).not.toContain("hidden-user-backup.zip");
    expect(JSON.stringify(summaries)).not.toContain("hidden-rollback.zip");
  });

  it("reconciles interrupted jobs conservatively on startup", () => {
    const { vaultPath, vault } = makeVault();
    const { jobs } = makeServices(vaultPath, vault);
    const jobsPath = path.join(vaultPath, ".pige", "jobs", "2026", "07");
    fs.mkdirSync(jobsPath, { recursive: true });
    const records = [
      {
        id: "job_20260710_capture01",
        class: "capture",
        state: "running",
        cancellation: {
          safeCheckpointId: "capture_source_page_publication_started",
          durableWritesApplied: true
        }
      },
      { id: "job_20260710_parse0001", class: "parse", state: "running" },
      { id: "job_20260710_ocr000001", class: "ocr", state: "running" },
      { id: "job_20260710_agent0001", class: "agent_ingest", state: "running" },
      { id: "job_20260710_backup001", class: "backup", state: "running" },
      { id: "job_20260710_restore01", class: "restore", state: "running" },
      { id: "job_20260710_maint0001", class: "maintenance", state: "running" },
      {
        id: "job_20260710_cancel001",
        class: "parse",
        state: "cancel_requested",
        cancellation: {
          requestedAt: "2026-07-10T01:01:00.000Z",
          requestedBy: "user"
        }
      }
    ] as const;
    for (const record of records) {
      fs.writeFileSync(path.join(jobsPath, `${record.id}.json`), `${JSON.stringify({
        ...record,
        createdAt: "2026-07-10T01:00:00.000Z",
        updatedAt: "2026-07-10T01:01:00.000Z",
        message: "Interrupted fixture job."
      }, null, 2)}\n`, "utf8");
    }

    const result = jobs.recoverInterruptedJobs();
    const queued = jobs.list({ states: ["queued"], limit: 10 }).jobs;
    const retryable = jobs.list({ states: ["failed_retryable"], limit: 10 }).jobs;

    expect(result).toEqual({ requeued: 4, failedRetryable: 2 });
    expect(queued.map((job) => job.class).sort()).toEqual(["agent_ingest", "capture", "ocr", "parse"]);
    expect(queued.every((job) => job.message.includes("validated outputs will be reused"))).toBe(true);
    expect(readJobCancellation(vaultPath, "job_20260710_capture01")).toEqual({
      safeCheckpointId: "capture_source_page_publication_started",
      durableWritesApplied: true
    });
    expect(retryable.map((job) => job.id).sort()).toEqual([
      "job_20260710_maint0001",
      "job_20260710_restore01"
    ]);
    expect(jobs.list({ states: ["cancelled"], limit: 10 }).jobs).toEqual([
      expect.objectContaining({ id: "job_20260710_cancel001", state: "cancelled" })
    ]);
    expect(jobs.list({ classes: ["backup"], limit: 10 }).jobs).toEqual([
      expect.objectContaining({ id: "job_20260710_backup001", state: "running" })
    ]);
    expect(jobs.list({ classes: ["restore"], limit: 10 }).jobs).toEqual([
      expect.objectContaining({ id: "job_20260710_restore01", state: "failed_retryable" })
    ]);
    expect(jobs.cancel({ jobId: "job_20260710_maint0001" })).toMatchObject({
      status: "not_allowed",
      job: { id: "job_20260710_maint0001", state: "failed_retryable" }
    });
  });

  it("marks an interrupted Home retrieval query retryable without queuing an unsupported generic retry", () => {
    const { vaultPath, vault } = makeVault();
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const created = jobs.createRetrievalQueryJob({ queryHash: `sha256:${"a".repeat(64)}` });
    jobs.writeRetrievalQueryJob(created, JobRecordSchema.parse({
      ...created,
      state: "running",
      stage: "retrieving",
      startedAt: "2026-07-11T01:00:00.000Z",
      updatedAt: "2026-07-11T01:00:00.000Z",
      message: "Home Agent is retrieving bounded local evidence."
    }));

    const restarted = new JobsService(vaults);
    expect(restarted.recoverInterruptedJobs()).toEqual({ requeued: 0, failedRetryable: 1 });
    const recovered = requireValue(restarted.list({ classes: ["retrieval_query"] }).jobs[0]);
    expect(recovered).toMatchObject({ id: created.id, state: "failed_retryable" });
    expect(restarted.retry({ jobId: created.id })).toMatchObject({
      status: "not_allowed",
      job: { id: created.id, state: "failed_retryable" }
    });
  });

  it("rejects a stale whole-record Agent turn write instead of erasing a committed reference", () => {
    const { vaultPath, vault } = makeVault();
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const created = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260714_staleturn1",
      conversationLocator: ".pige/conversations/2026/07/conv_20260714.jsonl",
      inputHash: `sha256:${"b".repeat(64)}`
    });
    const committed = jobs.testOnlyWriteAgentTurnJob(created, JobRecordSchema.parse({
      ...created,
      operationIds: ["op_20260714_staleturn1"],
      message: "A concurrent durable reference was committed."
    }));

    expect(() => jobs.testOnlyWriteAgentTurnJob(created, JobRecordSchema.parse({
      ...created,
      state: "running",
      stage: "planning",
      message: "A stale session attempted to replace the current record."
    }))).toThrowError(expect.objectContaining({ code: "job.revision_conflict" }));
    expect(jobs.readAgentTurnJob(created.id)).toEqual(committed);
    expect(jobs.readAgentTurnJob(created.id)?.operationIds).toEqual(["op_20260714_staleturn1"]);
  });

  it("seals one ordered attachment manifest into the parent Agent Job identity", () => {
    const { vaultPath, vault } = makeVault();
    const jobs = new JobsService({ current: () => vault, activeVaultPath: () => vaultPath });
    const attachmentSetHash = `sha256:${"a".repeat(64)}`;
    const sourceChecksums = ["b", "c", "d"].map((value) => `sha256:${value.repeat(64)}`);
    const request = {
      conversationEventId: "evt_20260722_multifile001",
      conversationLocator: ".pige/conversations/2026/07/conv_20260722.jsonl",
      inputHash: `sha256:${"e".repeat(64)}`,
      sourceExpected: true,
      attachmentCount: 3,
      attachmentSetHash,
      sourceChecksums
    };

    const created = jobs.createAgentTurnJob(request);
    const sourceRefs = created.inputRefs?.filter((ref) => ref.role === "agent_turn_source") ?? [];

    expect(created).toMatchObject({
      state: "waiting_dependency",
      stage: "capturing_source",
      sourceId: sourceRefs[0]?.id
    });
    expect(sourceRefs.map((ref) => ({ id: ref.id, locator: ref.locator, checksum: ref.checksum }))).toEqual([
      { id: expect.stringMatching(/^src_20260722_/u), locator: "attachment_1", checksum: sourceChecksums[0] },
      { id: expect.stringMatching(/^src_20260722_/u), locator: "attachment_2", checksum: sourceChecksums[1] },
      { id: expect.stringMatching(/^src_20260722_/u), locator: "attachment_3", checksum: sourceChecksums[2] }
    ]);
    expect(created.inputRefs).toEqual(expect.arrayContaining([{
      kind: "tool",
      id: "pige_agent_attachment_set",
      checksum: attachmentSetHash,
      role: "agent_turn_attachment_set"
    }]));
    expect(jobs.createAgentTurnJob(request)).toEqual(created);
    expect(() => jobs.createAgentTurnJob({
      ...request,
      sourceChecksums: [sourceChecksums[0]!, sourceChecksums[1]!, `sha256:${"f".repeat(64)}`]
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_conflict" }));
  });

  it("converges a partial preservation failure and adopts the same parent on explicit retry", async () => {
    const { vaultPath, vault } = makeVault();
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const capture = new CaptureService(vaults);
    const inputRoot = path.dirname(vaultPath);
    const filePaths = ["first.md", "second.txt"].map((name) => {
      const filePath = path.join(inputRoot, name);
      fs.writeFileSync(filePath, name);
      return filePath;
    });
    const sourceChecksums = filePaths.map((filePath) =>
      `sha256:${createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")}`
    );
    const attachmentSetHash = `sha256:${"a".repeat(64)}`;
    const request = {
      conversationEventId: "evt_20260722_partialcopy1",
      conversationLocator: ".pige/conversations/2026/07/conv_20260722.jsonl",
      inputHash: `sha256:${"b".repeat(64)}`,
      sourceExpected: true,
      attachmentCount: 2,
      attachmentSetHash,
      sourceChecksums
    };
    const created = jobs.createAgentTurnJob(request);
    const sourceIds = (created.inputRefs ?? [])
      .filter((ref) => ref.kind === "source" && ref.role === "agent_turn_source")
      .map((ref) => requireValue(ref.id));

    await capture.preserveFilesForAgentTurn({
      filePaths: [filePaths[0]!],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, {
      jobId: created.id,
      sourceId: sourceIds[0]!,
      inputChecksum: sourceChecksums[0],
      ordinal: 0,
      attachmentSetHash
    });
    expect(jobs.failAgentTurnSourcePreservation(created.id)).toMatchObject({
      id: created.id,
      state: "failed_retryable",
      retry: { lastRetryReason: "agent_turn.source_preservation_failed", requiresUserAction: true }
    });
    expect(jobs.createAgentTurnJob(request).id).toBe(created.id);

    for (const [ordinal, filePath] of filePaths.entries()) {
      await capture.preserveFilesForAgentTurn({
        filePaths: [filePath],
        inputKind: "file_picker",
        userIntent: "unknown",
        locale: "en"
      }, {
        jobId: created.id,
        sourceId: sourceIds[ordinal]!,
        inputChecksum: sourceChecksums[ordinal],
        ordinal,
        attachmentSetHash
      });
    }
    expect(jobs.attachAgentTurnSources(created.id, sourceIds, attachmentSetHash)).toMatchObject({
      id: created.id,
      state: "queued"
    });
    expect(listFiles(path.join(vaultPath, ".pige", "source-records")))
      .toHaveLength(2);
  });

  it("creates current-note Jobs with an atomic scope ref and never adopts a missing legacy binding", () => {
    const { vaultPath, vault } = makeVault();
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const bindingHash = `sha256:${"c".repeat(64)}`;
    const currentNoteScope = {
      pageId: "page_20260716_atomicnote",
      bindingHash,
      selection: {
        pageId: "page_20260716_atomicnote",
        pageContentHash: `sha256:${"a".repeat(64)}`,
        span: { unit: "utf8_bytes" as const, start: 200, endExclusive: 212 },
        selectedContentHash: `sha256:${"b".repeat(64)}`
      },
      transformAction: "translate" as const
    };
    const atomic = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260716_atomicnote01",
      conversationLocator: ".pige/conversations/2026/07/conv_20260716.jsonl",
      inputHash: `sha256:${"d".repeat(64)}`,
      currentNoteScope
    });
    expect(atomic.inputRefs).toEqual(expect.arrayContaining([
      {
        kind: "page",
        id: currentNoteScope.pageId,
        role: "agent_turn_current_note_scope",
        checksum: bindingHash
      }
    ]));
    expect(atomic.inputRefs).toEqual(expect.arrayContaining([
      {
        kind: "page",
        id: currentNoteScope.pageId,
        role: "agent_turn_reader_selection",
        checksum: currentNoteScope.selection.selectedContentHash,
        locator: "utf8_bytes:200:212"
      }
    ]));
    expect(atomic.inputRefs).toEqual(expect.arrayContaining([{
      kind: "tool",
      id: "reader_selection_translate",
      role: "agent_turn_reader_transform",
      checksum: currentNoteScope.selection.pageContentHash
    }]));
    expect(jobs.createAgentTurnJob({
      conversationEventId: "evt_20260716_atomicnote01",
      conversationLocator: ".pige/conversations/2026/07/conv_20260716.jsonl",
      inputHash: `sha256:${"d".repeat(64)}`,
      currentNoteScope
    })).toEqual(atomic);
    expect(() => jobs.createAgentTurnJob({
      conversationEventId: "evt_20260716_atomicnote01",
      conversationLocator: ".pige/conversations/2026/07/conv_20260716.jsonl",
      inputHash: `sha256:${"d".repeat(64)}`,
      currentNoteScope: { ...currentNoteScope, transformAction: "polish" }
    })).toThrowError(expect.objectContaining({ code: "agent_runtime.turn_conflict" }));

    const legacyRequest = {
      conversationEventId: "evt_20260716_legacygap001",
      conversationLocator: ".pige/conversations/2026/07/conv_20260716_legacy.jsonl",
      inputHash: `sha256:${"e".repeat(64)}`
    };
    const legacy = jobs.createAgentTurnJob(legacyRequest);
    expect(legacy.inputRefs?.some((ref) => ref.role === "agent_turn_current_note_scope")).toBe(false);
    expect(() => jobs.createAgentTurnJob({ ...legacyRequest, currentNoteScope }))
      .toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));

    const startedRequest = {
      conversationEventId: "evt_20260716_startedgap01",
      conversationLocator: ".pige/conversations/2026/07/conv_20260716_started.jsonl",
      inputHash: `sha256:${"f".repeat(64)}`
    };
    const started = jobs.createAgentTurnJob(startedRequest);
    jobs.testOnlyWriteAgentTurnJob(started, JobRecordSchema.parse({
      ...started,
      state: "running",
      stage: "planning",
      startedAt: "2026-07-16T01:00:00.000Z",
      updatedAt: "2026-07-16T01:00:00.000Z"
    }));
    expect(() => jobs.createAgentTurnJob({ ...startedRequest, currentNoteScope }))
      .toThrowError(expect.objectContaining({ code: "agent_runtime.turn_binding_invalid" }));
  });

  it("processes queued text captures into source pages and log entries", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "Source page title\n\nA compact captured idea.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    const processResult = jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${captureResult.sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePageId: string;
      knowledgePagePath: string;
    };
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");
    const log = fs.readFileSync(path.join(vaultPath, "log.md"), "utf8");
    const listedJob = jobs.list({ states: ["completed"] }).jobs[0];

    expect(processResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(sourceRecord.knowledgePageId).toMatch(/^page_\d{8}_[a-z0-9]{8,}$/);
    expect(sourceRecord.knowledgePagePath).toMatch(/^sources\/text\/\d{4}\/src_/);
    expect(sourcePage).toContain('type: "source"');
    expect(sourcePage).toContain(`source_ids: ["${captureResult.sourceId}"]`);
    expect(sourcePage).toContain("Source page title");
    expect(sourcePage).toContain("A compact captured idea.");
    expect(log).toContain(captureResult.sourceId);
    expect(listedJob?.id).toBe(captureResult.jobId);
    expect(listedJob?.state).toBe("completed");
  });

  it("blocks capture projection when the durable Job guard cannot be committed", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captured = capture.submitText({
      text: "The source projection must wait for its durable action-safety guard.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const jobPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${captured.jobId}.json`);
    const sourceRecordPath = findFile(
      path.join(vaultPath, ".pige", "source-records"),
      `${captured.sourceId}.json`
    );
    const sourceBefore = fs.readFileSync(sourceRecordPath, "utf8");
    const originalRename = fs.renameSync.bind(fs);
    let jobRenames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (path.resolve(String(newPath)) === path.resolve(jobPath)) {
        jobRenames += 1;
        if (jobRenames === 2) throw new Error("simulated durable guard commit failure");
      }
      originalRename(oldPath, newPath);
    });

    const result = jobs.processQueuedCaptures({ jobIds: [captured.jobId] });

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(jobRenames).toBe(3);
    expect(fs.readFileSync(sourceRecordPath, "utf8")).toBe(sourceBefore);
    expect(listFiles(path.join(vaultPath, "sources", "text")).filter((filePath) => filePath.endsWith(".md")))
      .toEqual([]);
    expect(readJobCancellation(vaultPath, captured.jobId)).toBeUndefined();
    expect(jobs.list({ classes: ["capture"], states: ["failed_retryable"] }).jobs[0]?.id)
      .toBe(captured.jobId);
  });

  it("persists the capture guard before the first projection write and keeps it after restart", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captured = capture.submitText({
      text: "A persisted guard must survive before any source-page byte is published.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const jobPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${captured.jobId}.json`);
    const sourceRecordPath = findFile(
      path.join(vaultPath, ".pige", "source-records"),
      `${captured.sourceId}.json`
    );
    const sourceBefore = fs.readFileSync(sourceRecordPath, "utf8");
    const originalRename = fs.renameSync.bind(fs);
    let guardedJobAtFirstProjection: Record<string, unknown> | undefined;
    vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (!guardedJobAtFirstProjection && path.resolve(String(newPath)) === path.resolve(sourceRecordPath)) {
        guardedJobAtFirstProjection = JSON.parse(fs.readFileSync(jobPath, "utf8")) as Record<string, unknown>;
        throw new Error("simulated failure before the first source projection rename");
      }
      originalRename(oldPath, newPath);
    });

    const result = jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    vi.restoreAllMocks();
    const restartedJobs = makeServices(vaultPath, vault).jobs;

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(guardedJobAtFirstProjection).toMatchObject({
      state: "running",
      cancellation: {
        safeCheckpointId: "capture_source_page_publication_started",
        durableWritesApplied: true
      }
    });
    expect(fs.readFileSync(sourceRecordPath, "utf8")).toBe(sourceBefore);
    expect(readJobCancellation(vaultPath, captured.jobId)).toEqual({
      safeCheckpointId: "capture_source_page_publication_started",
      durableWritesApplied: true
    });
    expect(restartedJobs.cancel({ jobId: captured.jobId })).toMatchObject({
      status: "not_allowed",
      job: { id: captured.jobId, state: "failed_retryable" }
    });
  });

  it("processes queued URL captures into web source pages from extracted text", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault, undefined, undefined, {
      fetchSnapshot: async () => ({
        originalUrl: "https://example.com/article?token=secret-token",
        finalUrl: "https://example.com/article?token=secret-token",
        contentType: "text/html",
        title: "URL Source",
        rawContent: "<html><script>ignore()</script><body>Raw HTML shell</body></html>",
        extractedText: "Readable article text.",
        warnings: []
      })
    });
    const captureResult = await capture.submitUrl({
      url: "https://example.com/article?token=secret-token",
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: "en"
    });

    const processResult = jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${captureResult.sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePagePath: string;
    };
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");

    expect(processResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(sourceRecord.knowledgePagePath).toMatch(/^sources\/web\/\d{4}\/src_/u);
    expect(sourcePage).toContain("Readable article text.");
    expect(sourcePage).toContain("token=%5Bredacted%5D");
    expect(sourcePage).not.toContain("<script>");
    expect(sourcePage).not.toContain("secret-token");
  });

  it("does not create an Agent ingest successor when a legacy capture completes", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "Process later when a model exists.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("does not resolve runtime credentials or create a successor after capture", () => {
    const { vaultPath, vault } = makeVault();
    let runtimeConfigReads = 0;
    const agentIngest = new AgentIngestService({
      getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
      getDefaultProvider: () => runtimeConfig.provider,
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        runtimeConfigReads += 1;
        return runtimeConfig;
      }
    });
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captureResult = capture.submitText({
      text: "Readiness scheduling must not resolve provider credentials.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    expect(jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
    expect(runtimeConfigReads).toBe(0);
  });

  it("creates a metadata-only source page without inferring a parser or Agent successor", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const sourcePath = path.join(path.dirname(vaultPath), "research.pdf");
    fs.writeFileSync(sourcePath, Buffer.from("%PDF-1.7\nDo not treat this binary as text."));

    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    const jobId = requireFirst(captureResult.jobIds);
    const processResult = jobs.processQueuedCaptures({ jobIds: [jobId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePagePath: string;
    };
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");

    expect(processResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(sourceRecord.knowledgePagePath).toMatch(/^sources\/files\/\d{4}\/src_/u);
    expect(sourcePage).toContain("No extracted text preview is available yet");
    expect(sourcePage).toContain("Source kind: `pdf_file`");
    expect(sourcePage).not.toContain("Do not treat this binary as text.");
    expect(jobs.list({ classes: ["parse"] }).jobs).toHaveLength(0);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toHaveLength(0);
    const captureJob = readJobRecord(vaultPath, jobId);
    expect(captureJob.childJobIds ?? []).toEqual([]);
  });

  it("recovers an interrupted capture by the same ID without inventing a child", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captured = capture.submitText({
      text: "A deterministic child survives a crash before its capture parent becomes terminal.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const originalRename = fs.renameSync.bind(fs);
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation((source, target) => {
      if (String(target).endsWith(`${captured.jobId}.json`)) {
        const candidate = JSON.parse(fs.readFileSync(String(source), "utf8")) as JobRecord;
        if (candidate.state !== "running") {
          const childIds = listJobRecords(vaultPath)
            .filter((job) => job.parentJobId === captured.jobId)
            .map((job) => job.id);
          expect(childIds).toHaveLength(0);
          expect(candidate.childJobIds ?? []).toEqual([]);
          throw new Error("Synthetic crash before parent terminalization.");
        }
      }
      return originalRename(source, target);
    });

    try {
      expect(() => jobs.processQueuedCaptures({ jobIds: [captured.jobId] }))
        .toThrow(expect.objectContaining({ code: "job.write_failed" }));
    } finally {
      renameSpy.mockRestore();
    }

    const interrupted = readJobRecord(vaultPath, captured.jobId);
    expect(interrupted.state).toBe("running");
    expect(interrupted.childJobIds ?? []).toEqual([]);
    expect(jobs.recoverInterruptedJobs()).toEqual({ requeued: 1, failedRetryable: 0 });
    expect(jobs.processQueuedCaptures({ jobIds: [captured.jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completedParent = readJobRecord(vaultPath, captured.jobId);
    expect(completedParent.state).toBe("completed");
    expect(completedParent.childJobIds ?? []).toEqual([]);
    expect(listJobRecords(vaultPath).filter((job) => job.parentJobId === captured.jobId)).toHaveLength(0);
  });

  it("rejects a byte-identical queued Job replacement before execution and retries without duplicate effects", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captured = capture.submitText({
      text: "Exact Job revisions fence stale queue selections before durable effects.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = captured.sourceId;
    const jobPath = findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`);
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const originalLstat = fs.lstatSync.bind(fs);
    let replaced = false;
    const lstatSpy = vi.spyOn(fs, "lstatSync").mockImplementation(((candidate: fs.PathLike, options?: unknown) => {
      if (!replaced && path.resolve(String(candidate)) === path.resolve(sourceRecordPath)) {
        replaced = true;
        const replacementPath = `${jobPath}.replacement`;
        fs.writeFileSync(replacementPath, fs.readFileSync(jobPath), { mode: 0o600 });
        fs.renameSync(replacementPath, jobPath);
      }
      return options === undefined
        ? originalLstat(candidate)
        : originalLstat(candidate, options as never);
    }) as typeof fs.lstatSync);

    try {
      expect(jobs.processQueuedCaptures({ jobIds: [captured.jobId] })).toEqual({
        processed: 1,
        completed: 0,
        failed: 1
      });
    } finally {
      lstatSpy.mockRestore();
    }

    expect(replaced).toBe(true);
    expect(readJobRecord(vaultPath, captured.jobId).state).toBe("queued");
    expect(listJobRecords(vaultPath).filter((job) => job.parentJobId === captured.jobId)).toHaveLength(0);
    expect(jobs.processQueuedCaptures({ jobIds: [captured.jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completed = readJobRecord(vaultPath, captured.jobId);
    expect(completed.state).toBe("completed");
    expect(new Set(completed.childJobIds ?? []).size).toBe(completed.childJobIds?.length ?? 0);
  });

  it("parses preserved PDFs into durable text artifacts before Agent ingest", async () => {
    const { vaultPath, vault } = makeVault();
    const pdfParser = makePdfParser();
    const { capture, jobs } = makeServices(vaultPath, vault, undefined, undefined, undefined, pdfParser);
    const sourcePath = path.join(path.dirname(vaultPath), "knowledge.pdf");
    const embeddedText = "Pige extracts embedded PDF text locally with stable page references.";
    fs.writeFileSync(sourcePath, createTestPdf([embeddedText], "PDF Knowledge"));

    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    expect(jobs.list({ classes: ["parse"], states: ["queued"] }).jobs[0]?.sourceId).toBe(sourceId);

    const parseResult = await jobs.processQueuedParses({ sourceIds: [sourceId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePagePath: string;
      artifacts: { id: string; kind: string; path: string }[];
      metadata: Record<string, unknown>;
    };
    const textArtifact = sourceRecord.artifacts.find((artifact) => artifact.kind === "extracted_text");
    const metadataArtifact = sourceRecord.artifacts.find((artifact) => artifact.kind === "metadata");
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");
    const extractedArtifactText = fs.readFileSync(path.join(vaultPath, requireValue(textArtifact?.path)), "utf8");
    const metadataSidecar = fs.readFileSync(path.join(vaultPath, requireValue(metadataArtifact?.path)), "utf8");
    const parsedSidecar = JSON.parse(metadataSidecar) as {
      readonly pages: readonly { readonly locator: string; readonly characterStart: number; readonly characterEnd: number }[];
    };
    const operation = fs.readFileSync(findFileContaining(path.join(vaultPath, ".pige/operations"), '"kind": "create_artifact"'), "utf8");

    expect(parseResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(jobs.list({ classes: ["parse"], states: ["completed"] }).jobs[0]?.sourceId).toBe(sourceId);
    expect(extractedArtifactText).toContain(embeddedText);
    expect(sourcePage).toContain("Pige preserved this source and extracted readable text locally");
    expect(sourcePage).toContain(embeddedText);
    expect(sourcePage).toContain(requireValue(textArtifact?.id));
    expect(sourcePage).not.toContain(requireValue(textArtifact?.path));
    expect(metadataSidecar).toContain('"locator": "page:1"');
    expect(metadataSidecar).not.toContain(embeddedText);
    const firstPage = requireValue(parsedSidecar.pages[0]);
    expect(extractedArtifactText.slice(firstPage.characterStart, firstPage.characterEnd)).toBe(embeddedText);
    expect(operation).toContain('"kind": "create_artifact"');
    expect(operation).toContain(requireValue(textArtifact?.path));
    expect(operation).not.toContain(embeddedText);
    expect(sourceRecord.metadata).toMatchObject({
      parserStatus: "parsed",
      parserEngine: "pdfjs-dist",
      parserVersion: "6.1.200",
      textCoverage: "high",
      agentTextReady: true
    });
    expect(sourceRecord.metadata.knowledgePageChecksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(jobs.list({ classes: ["ocr"], states: ["waiting_dependency"] }).jobs).toHaveLength(0);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("keeps the Agent continuation waiting while explicit PDF parsing hands image-only evidence to OCR", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault, undefined, undefined, undefined, makePdfParser());
    const sourcePath = path.join(path.dirname(vaultPath), "scan.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([""], "Scanned Page"));
    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);

    jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    const parseResult = await jobs.processQueuedParses({ sourceIds: [sourceId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      artifacts: { kind: string; path: string }[];
      metadata: Record<string, unknown>;
    };

    expect(parseResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(sourceRecord.artifacts.some((artifact) => artifact.kind === "extracted_text")).toBe(false);
    expect(sourceRecord.artifacts.some((artifact) => artifact.kind === "metadata")).toBe(true);
    expect(sourceRecord.metadata).toMatchObject({ parserStatus: "parsed_needs_ocr", textCoverage: "none", agentTextReady: false });
    expect(jobs.list({ classes: ["parse"], states: ["completed_with_warnings"] }).jobs[0]?.sourceId).toBe(sourceId);
    expect(jobs.list({ classes: ["ocr"] }).jobs).toEqual([]);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("uses source-aware OCR readiness after PDF parsing", async () => {
    const { vaultPath, vault } = makeVault();
    const pdfOcr: OcrPort = {
      canOcr: (sourceKind) => sourceKind === "pdf_file",
      inspectSource: (sourceRecord) => sourceRecord.kind === "pdf_file" &&
        sourceRecord.metadata.textCoverage === "none"
        ? { ready: true, message: "Image-only PDF parsed; local page OCR job queued." }
        : { ready: false, message: "Mixed PDF is waiting for bounded OCR page routing." },
      ocrSource: async () => {
        throw new Error("OCR execution is outside this routing test.");
      }
    };
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      makePdfParser(),
      pdfOcr
    );
    const sourceRoot = path.dirname(vaultPath);
    const scanPath = path.join(sourceRoot, "scan-ready.pdf");
    const mixedPath = path.join(sourceRoot, "mixed-waiting.pdf");
    fs.writeFileSync(scanPath, createTestPdf([""], "Scan"));
    fs.writeFileSync(mixedPath, createTestPdf([
      "This embedded page has enough native text to remain independent evidence for the Agent.",
      ""
    ], "Mixed"));
    const captured = await capture.submitFiles({
      filePaths: [scanPath, mixedPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    for (const sourceId of captured.sourceIds) seedExplicitPdfParseJob(vaultPath, sourceId);
    await jobs.processQueuedParses({ sourceIds: captured.sourceIds, limit: 10 });

    expect(jobs.list({ classes: ["ocr"], limit: 10 }).jobs).toEqual([]);
  });

  it("renders and OCRs an image-only PDF through the recoverable Job pipeline", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult({
      text: "Scanned PDF knowledge is searchable.",
      blocks: [{
        text: "Scanned PDF knowledge is searchable.",
        kind: "line",
        confidence: 0.93,
        boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
        languageHints: ["en"],
        isTitle: false
      }],
      confidence: 0.93
    }));
    const renderer = new StaticPdfPageRenderer();
    const ocr = new OcrService(adapter, undefined, renderer);
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      makePdfParser(),
      ocr
    );
    const sourcePath = path.join(path.dirname(vaultPath), "rendered-scan.pdf");
    fs.writeFileSync(sourcePath, createJpegScanPdf(1));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    const parsed = await jobs.processQueuedParses({ sourceIds: [sourceId] });
    expect(parsed).toEqual({ processed: 1, completed: 1, failed: 0 });
    seedExplicitImageOcrJob(vaultPath, sourceId);

    const firstRun = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePagePath: string;
      artifacts: { id: string; kind: string; path: string }[];
      metadata: Record<string, unknown>;
    };
    expect(firstRun).toEqual({ processed: 1, completed: 1, failed: 0 });
    const ocrArtifact = requireValue(sourceRecord.artifacts.find((artifact) => artifact.kind === "ocr"));
    const ocrSidecar = requireValue(sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_pdf_ocr_metadata")));
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");

    expect(renderer.callCount).toBe(1);
    expect(adapter.callCount).toBe(1);
    expect(renderer.inputPaths[0]).toContain(`${path.sep}pige-verified-input-`);
    expect(adapter.inputPaths[0]).toContain(`${path.sep}pige-verified-input-`);
    expect(fs.existsSync(requireValue(renderer.inputPaths[0]))).toBe(false);
    expect(fs.existsSync(requireValue(adapter.inputPaths[0]))).toBe(false);
    expect(fs.readFileSync(path.join(vaultPath, ocrArtifact.path), "utf8")).toContain("Scanned PDF knowledge is searchable.");
    expect(fs.readFileSync(path.join(vaultPath, ocrSidecar.path), "utf8")).toContain('"locator": "page:1/ocr:block:1"');
    expect(sourcePage).toContain("Scanned PDF knowledge is searchable.");
    expect(sourceRecord.metadata).toMatchObject({
      parserStatus: "parsed_needs_ocr",
      textCoverage: "none",
      ocrStatus: "completed",
      needsOcr: false,
      agentTextReady: true
    });
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);

    const completedJob = requireValue(jobs.list({ classes: ["ocr"], states: ["completed"] }).jobs[0]);
    const completedJobPath = findFile(path.join(vaultPath, ".pige/jobs"), `${completedJob.id}.json`);
    const jobRecord = JSON.parse(fs.readFileSync(completedJobPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(completedJobPath, `${JSON.stringify({ ...jobRecord, state: "running" }, null, 2)}\n`, "utf8");
    adapter.available = false;
    expect(jobs.recoverInterruptedJobs()).toEqual({ requeued: 1, failedRetryable: 0 });
    expect(await jobs.processQueuedOcr({ sourceIds: [sourceId] })).toMatchObject({ completed: 1, failed: 0 });
    expect(renderer.callCount).toBe(1);
    expect(adapter.callCount).toBe(1);
  });

  it("delays Agent ingest until sparse mixed-PDF pages join native evidence", async () => {
    const { vaultPath, vault } = makeVault();
    const nativePageText = "Native PDF evidence explains the durable knowledge model and remains useful while one sparse page needs OCR enrichment.";
    const ocrPageText = "OCR recovered the second page's local-only implementation detail.";
    const modelClient = new StaticModelClient({
      title: "Combined PDF evidence",
      summary: { text: "The PDF combines native and OCR evidence.", evidenceRefs: ["ev_01", "ev_02"] },
      keyPoints: [
        { text: "Native page retained", evidenceRefs: ["ev_01"] },
        { text: "Sparse page recovered", evidenceRefs: ["ev_02"] }
      ],
      tags: ["pdf"],
      topics: ["Evidence"],
      entities: ["Pige"],
      warnings: [],
      confidence: "high"
    });
    const agentIngest = new AgentIngestService(makeModelPort(), modelClient);
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult({
      text: ocrPageText,
      blocks: [{
        text: ocrPageText,
        kind: "line",
        confidence: 0.91,
        boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
        languageHints: ["en"],
        isTitle: false
      }],
      confidence: 0.91
    }));
    const renderer = new StaticPdfPageRenderer();
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      agentIngest,
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, renderer)
    );
    const sourcePath = path.join(path.dirname(vaultPath), "mixed-evidence.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([nativePageText, ""], "Mixed Evidence"));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    const parsed = await jobs.processQueuedParses({ sourceIds: [sourceId] });

    expect(parsed).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
    seedExplicitImageOcrJob(vaultPath, sourceId);

    const ocrResult = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    expect(ocrResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(renderer.requestedPageSets).toEqual([[2]]);
    expect(adapter.callCount).toBe(1);
    seedHistoricalAgentIngestJob(vaultPath, sourceId);

    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      artifacts: { kind: string }[];
      metadata: Record<string, unknown>;
    };
    expect(sourceRecord.artifacts.filter((artifact) => artifact.kind === "extracted_text")).toHaveLength(1);
    expect(sourceRecord.artifacts.filter((artifact) => artifact.kind === "ocr")).toHaveLength(1);
    expect(sourceRecord.metadata).toMatchObject({
      textCoverage: "medium",
      ocrProcessedPages: [2],
      needsOcr: false,
      agentTextReady: true
    });

    const agentResult = await jobs.processQueuedAgentIngest({ sourceIds: [sourceId] });
    const prompt = requireValue(modelClient.requests[0]).user;
    const note = fs.readFileSync(findFile(path.join(vaultPath, "wiki"), ".md"), "utf8");
    expect(agentResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(prompt).toContain('ref="ev_01"');
    expect(prompt).toContain('kind="extracted_text" locator="page:1"');
    expect(prompt).toContain(nativePageText.slice(0, 72));
    expect(prompt).toContain('ref="ev_02"');
    expect(prompt).toContain('kind="ocr" locator="page:2/ocr:block:1"');
    expect(prompt).toContain(ocrPageText);
    expect(prompt).toContain("- ocr_enrichment_pending: false");
    expect(note).toContain(`[source:${sourceId}#p1]`);
    expect(note).toContain(`[source:${sourceId}#p2-ocr1]`);
  });

  it("does not reintroduce a host-owned PDF OCR pause after explicit parsing", async () => {
    const { vaultPath, vault } = makeVault();
    const modelClient = new StaticModelClient({
      title: "Late OCR enrichment",
      summary: { text: "Verified native text remains usable while optional OCR proceeds separately.", evidenceRefs: ["ev_01"] },
      keyPoints: [
        { text: "Native evidence", evidenceRefs: ["ev_01"] }
      ],
      tags: [],
      topics: ["Evidence"],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult({
      text: "OCR capability recovered before Agent execution.",
      blocks: [{
        text: "OCR capability recovered before Agent execution.",
        kind: "line",
        confidence: 0.9,
        boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
        languageHints: ["en"],
        isTitle: false
      }],
      confidence: 0.9
    }), false);
    const renderer = new StaticPdfPageRenderer();
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient),
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, renderer)
    );
    const sourcePath = path.join(path.dirname(vaultPath), "late-ocr.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([
      "Verified native text is useful while a sparse second page waits for local OCR capability.",
      ""
    ], "Late OCR"));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    const parsed = await jobs.processQueuedParses({ sourceIds: [sourceId] });

    expect(parsed).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
    expect(jobs.list({ classes: ["ocr"] }).jobs).toEqual([]);
    seedHistoricalAgentIngestJob(vaultPath, sourceId);
    seedExplicitImageOcrJob(vaultPath, sourceId, "waiting_dependency");

    adapter.available = true;
    expect(jobs.requeueWaitingOcr()).toEqual({ requeued: 1 });
    expect(await jobs.processQueuedAgentIngest({ sourceIds: [sourceId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(modelClient.requests).toHaveLength(1);
    expect(jobs.list({ classes: ["agent_ingest"], states: ["completed_with_warnings"] }).jobs[0]?.sourceId)
      .toBe(sourceId);
    const noteBeforeOcr = fs.readFileSync(findFile(path.join(vaultPath, "wiki"), ".md"), "utf8");
    expect(noteBeforeOcr).toContain("Some visible document content may still be waiting for local OCR enrichment.");

    expect(await jobs.processQueuedOcr({ sourceIds: [sourceId] }))
      .toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(modelClient.requests).toHaveLength(1);
    expect(renderer.requestedPageSets).toEqual([[2]]);
  });

  it("releases verified native PDF text when OCR becomes unavailable after parsing", async () => {
    const { vaultPath, vault } = makeVault();
    const modelClient = new StaticModelClient({
      title: "Native PDF fallback",
      summary: { text: "Verified native text remains usable while OCR is unavailable.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Native evidence retained", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: ["Evidence"],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult(), true);
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient),
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, new StaticPdfPageRenderer())
    );
    const sourcePath = path.join(path.dirname(vaultPath), "ocr-dropped.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([
      "Verified native text must remain usable when the OCR helper disappears after parse routing.",
      ""
    ], "OCR Dropped"));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    expect(await jobs.processQueuedParses({ sourceIds: [sourceId] }))
      .toEqual({ processed: 1, completed: 1, failed: 0 });
    seedHistoricalAgentIngestJob(vaultPath, sourceId);
    seedExplicitImageOcrJob(vaultPath, sourceId);

    adapter.available = false;
    expect(await jobs.processQueuedOcr({ sourceIds: [sourceId] }))
      .toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(jobs.list({ classes: ["ocr"], states: ["waiting_dependency"] }).jobs[0]?.sourceId).toBe(sourceId);
    expect(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]?.sourceId).toBe(sourceId);

    expect(await jobs.processQueuedAgentIngest({ sourceIds: [sourceId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(requireValue(modelClient.requests[0]).user).toContain("- ocr_enrichment_pending: true");
    const note = fs.readFileSync(findFile(path.join(vaultPath, "wiki"), ".md"), "utf8");
    expect(note).toContain('status: "needs_review"');
    expect(note).toContain("Some visible document content may still be waiting for local OCR enrichment.");
  });

  it("requeues Agent ingest when OCR changes the evidence during a model call", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult({
      text: "OCR completed while the first model request was in flight.",
      blocks: [{
        text: "OCR completed while the first model request was in flight.",
        kind: "line",
        confidence: 0.92,
        boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
        languageHints: ["en"],
        isTitle: false
      }],
      confidence: 0.92
    }), false);
    let jobs!: JobsService;
    const modelClient = new StaticModelClient({
      title: "Fresh combined evidence",
      summary: { text: "Both evidence revisions are present.", evidenceRefs: ["ev_01", "ev_02"] },
      keyPoints: [
        { text: "Native evidence", evidenceRefs: ["ev_01"] },
        { text: "OCR evidence", evidenceRefs: ["ev_02"] }
      ],
      tags: [],
      topics: ["Evidence"],
      entities: [],
      warnings: [],
      confidence: "high"
    }, async () => {
      if (modelClient.requests.length !== 1) return;
      adapter.available = true;
      expect(jobs.requeueWaitingOcr()).toEqual({ requeued: 1 });
      expect(await jobs.processQueuedOcr()).toMatchObject({ completed: 1, failed: 0 });
    });
    const services = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient),
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, new StaticPdfPageRenderer())
    );
    jobs = services.jobs;
    const sourcePath = path.join(path.dirname(vaultPath), "mid-call-ocr.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([
      "The first page is valid native evidence before a sparse second page is recognized.",
      ""
    ], "Mid-call OCR"));
    const captured = await services.capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    await jobs.processQueuedParses({ sourceIds: [sourceId] });
    seedHistoricalAgentIngestJob(vaultPath, sourceId);
    seedExplicitImageOcrJob(vaultPath, sourceId, "waiting_dependency");

    expect(await jobs.processQueuedAgentIngest({ sourceIds: [sourceId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]?.message).toContain(
      "requeued with the latest evidence"
    );
    expect(listFiles(path.join(vaultPath, "wiki")).filter((file) => file.endsWith(".md"))).toHaveLength(0);

    expect(await jobs.processQueuedAgentIngest({ sourceIds: [sourceId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(modelClient.requests).toHaveLength(2);
    expect(modelClient.requests[1]?.user).toContain('kind="ocr" locator="page:2/ocr:block:1"');
    const note = fs.readFileSync(findFile(path.join(vaultPath, "wiki"), ".md"), "utf8");
    expect(note).toContain(`[source:${sourceId}#p2-ocr1]`);
  });

  it("fails closed before PDF rendering when parser target metadata is tampered", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult());
    const renderer = new StaticPdfPageRenderer();
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, renderer)
    );
    const sourcePath = path.join(path.dirname(vaultPath), "tampered-target.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([
      "This native page is long enough to make the empty second page the sole OCR target.",
      ""
    ], "Tampered Target"));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    await jobs.processQueuedParses({ sourceIds: [sourceId] });
    seedExplicitImageOcrJob(vaultPath, sourceId);
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      artifacts: { id: string; path: string }[];
    };
    const parserMetadata = requireValue(sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_pdf_metadata")));
    const parserMetadataPath = path.join(vaultPath, parserMetadata.path);
    const sidecar = JSON.parse(fs.readFileSync(parserMetadataPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(parserMetadataPath, `${JSON.stringify({ ...sidecar, ocrCandidatePages: [1] }, null, 2)}\n`, "utf8");

    const result = await jobs.processQueuedOcr({ sourceIds: [sourceId] });

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(renderer.callCount).toBe(0);
    expect(adapter.callCount).toBe(0);
    expect(jobs.list({ classes: ["ocr"], states: ["failed_final"] }).jobs[0]?.message).toContain("failed validation");
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("does not create an OCR successor when parse completion fails", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult());
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, new StaticPdfPageRenderer())
    );
    const sourcePath = path.join(path.dirname(vaultPath), "parse-handoff.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([
      "Native text remains valid while a sparse page creates an OCR follow-up.",
      ""
    ], "Parse Handoff"));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    replaceLogWithDirectory(vaultPath);

    const parseResult = await jobs.processQueuedParses({ sourceIds: [sourceId] });
    expect(parseResult).toEqual({ processed: 1, completed: 0, failed: 1 });
    const parseJob = requireValue(jobs.list({ classes: ["parse"], states: ["failed_retryable"] }).jobs[0]);
    expect(parseJob.sourceId).toBe(sourceId);
    expect(readJobRecord(vaultPath, parseJob.id).childJobIds ?? []).toEqual([]);
    expect(jobs.list({ classes: ["ocr"] }).jobs).toEqual([]);
  });

  it("does not create an Agent successor when OCR completion fails", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult());
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), new StaticModelClient({
        title: "Recoverable handoff",
        summary: { text: "OCR evidence survived parent finalization failure.", evidenceRefs: ["ev_01"] },
        keyPoints: [{ text: "Evidence retained", evidenceRefs: ["ev_01"] }],
        tags: [],
        topics: [],
        entities: [],
        warnings: [],
        confidence: "high"
      })),
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, new StaticPdfPageRenderer())
    );
    const sourcePath = path.join(path.dirname(vaultPath), "ocr-handoff.pdf");
    fs.writeFileSync(sourcePath, createJpegScanPdf(1));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    await jobs.processQueuedParses({ sourceIds: [sourceId] });
    seedExplicitImageOcrJob(vaultPath, sourceId);
    const queuedOcr = requireValue(jobs.list({ classes: ["ocr"], states: ["queued"] }).jobs[0]);
    replaceLogWithDirectory(vaultPath);

    const ocrResult = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    expect(ocrResult).toEqual({ processed: 1, completed: 0, failed: 1 });
    const ocrJob = requireValue(jobs.list({ classes: ["ocr"], states: ["failed_retryable"] }).jobs[0]);
    expect(ocrJob.sourceId).toBe(sourceId);
    expect(readJobRecord(vaultPath, queuedOcr.id).childJobIds ?? []).toEqual([]);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("keeps incomplete PDF rendering retryable without scheduling Agent ingest", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult());
    const renderer = new StaticPdfPageRenderer(true);
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      makePdfParser(),
      new OcrService(adapter, undefined, renderer)
    );
    const sourcePath = path.join(path.dirname(vaultPath), "incomplete-scan.pdf");
    fs.writeFileSync(sourcePath, createJpegScanPdf(1));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    await jobs.processQueuedParses({ sourceIds: [sourceId] });
    seedExplicitImageOcrJob(vaultPath, sourceId);

    const result = await jobs.processQueuedOcr({ sourceIds: [sourceId] });

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(adapter.callCount).toBe(0);
    expect(jobs.list({ classes: ["ocr"], states: ["failed_retryable"] }).jobs[0]?.message).toContain("validated artifacts remain retryable");
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("preserves a user-edited source page while keeping validated PDF artifacts", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault, undefined, undefined, undefined, makePdfParser());
    const sourcePath = path.join(path.dirname(vaultPath), "edited.pdf");
    fs.writeFileSync(sourcePath, createTestPdf([
      "This PDF contains enough embedded text to be useful while the user-owned source page remains protected from overwrite."
    ]));
    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);
    const beforeRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const beforeRecord = JSON.parse(fs.readFileSync(beforeRecordPath, "utf8")) as { knowledgePagePath: string };
    const sourcePagePath = path.join(vaultPath, beforeRecord.knowledgePagePath);
    fs.appendFileSync(sourcePagePath, "\nUser-authored source-page note.\n", "utf8");

    const parseResult = await jobs.processQueuedParses({ sourceIds: [sourceId] });
    const afterRecord = JSON.parse(fs.readFileSync(beforeRecordPath, "utf8")) as {
      artifacts: { kind: string; path: string }[];
      metadata: Record<string, unknown>;
    };

    expect(parseResult.completed).toBe(1);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
    expect(fs.readFileSync(sourcePagePath, "utf8")).toContain("User-authored source-page note.");
    expect(afterRecord.artifacts.some((artifact) => artifact.kind === "extracted_text")).toBe(true);
    expect(afterRecord.metadata.sourcePageRefreshConflict).toBe(true);
    expect(jobs.list({ classes: ["parse"], states: ["completed_with_warnings"] }).jobs[0]?.message).toContain("edited source page was preserved");
  });

  it("preserves Office documents and images without Host-selected successors", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const sourceRoot = path.dirname(vaultPath);
    const documentPaths = [
      path.join(sourceRoot, "brief.docx"),
      path.join(sourceRoot, "deck.pptx")
    ];
    const imagePath = path.join(sourceRoot, "scan.png");
    for (const sourcePath of documentPaths) {
      fs.writeFileSync(sourcePath, Buffer.from("preserved document bytes"));
    }
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));

    const captureResult = await capture.submitFiles({
      filePaths: [...documentPaths, imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    const processResult = jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    const parserJobs = jobs.list({ classes: ["parse"], states: ["waiting_dependency"], limit: 10 }).jobs;
    const ocrJobs = jobs.list({ classes: ["ocr"], states: ["waiting_dependency"], limit: 10 }).jobs;
    const agentJobs = jobs.list({ classes: ["agent_ingest"], states: ["waiting_dependency"], limit: 10 }).jobs;

    expect(processResult).toEqual({ processed: 3, completed: 3, failed: 0 });
    expect(parserJobs).toEqual([]);
    expect(agentJobs).toEqual([]);
    expect(ocrJobs).toEqual([]);
  });

  it("persists image OCR artifacts, refreshes the source page, and reuses validated output after recovery", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult(), false);
    const ocr = new OcrService(adapter);
    const { capture, jobs } = makeServices(vaultPath, vault, undefined, undefined, undefined, undefined, ocr);
    const imagePath = path.join(path.dirname(vaultPath), "knowledge.png");
    fs.writeFileSync(imagePath, Buffer.from("synthetic-image-for-ocr"));
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(vaultPath, sourceId, "waiting_dependency");
    expect(jobs.list({ classes: ["ocr"], states: ["waiting_dependency"] }).jobs[0]?.sourceId).toBe(sourceId);

    adapter.available = true;
    expect(jobs.requeueWaitingOcr()).toEqual({ requeued: 1 });
    const firstRun = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePagePath: string;
      artifacts: { id: string; kind: string; path: string; checksum?: string; size?: number }[];
      metadata: Record<string, unknown>;
    };
    const textArtifact = requireValue(sourceRecord.artifacts.find((artifact) => artifact.kind === "ocr"));
    const metadataArtifact = requireValue(sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_ocr_metadata")));
    const ocrText = fs.readFileSync(path.join(vaultPath, textArtifact.path), "utf8");
    const sidecarText = fs.readFileSync(path.join(vaultPath, metadataArtifact.path), "utf8");
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");
    const operation = fs.readFileSync(findFile(path.join(vaultPath, ".pige/operations"), ".json"), "utf8");

    expect(firstRun).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(adapter.callCount).toBe(1);
    expect(ocrText).toBe("Pige OCR recovered local knowledge.\n");
    expect(sourcePage).toContain("Pige OCR recovered local knowledge.");
    expect(sidecarText).toContain('"locator": "ocr:block:1"');
    expect(sidecarText).toContain('"boundingBox"');
    expect(sidecarText).not.toContain("Pige OCR recovered local knowledge.");
    expect(operation).toContain('"kind": "create_artifact"');
    expect(operation).not.toContain("Pige OCR recovered local knowledge.");
    expect(textArtifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(metadataArtifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(textArtifact.size).toBe(fs.statSync(path.join(vaultPath, textArtifact.path)).size);
    expect(metadataArtifact.size).toBe(fs.statSync(path.join(vaultPath, metadataArtifact.path)).size);
    expect(sourceRecord.metadata).toMatchObject({
      parserStatus: "ocr_completed",
      ocrStatus: "completed",
      ocrAdapterId: "macos_vision_ocr",
      ocrAdapterVersion: "1.0.0",
      ocrEngine: "macos_vision_document",
      ocrConfidence: 0.94,
      ocrTextCharacterCount: 35,
      agentTextReady: true,
      needsOcr: false
    });
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);

    const completedOcrJob = requireValue(jobs.list({ classes: ["ocr"], states: ["completed"] }).jobs[0]);
    const completedOcrJobPath = findFile(path.join(vaultPath, ".pige/jobs"), `${completedOcrJob.id}.json`);
    const interrupted = JSON.parse(fs.readFileSync(completedOcrJobPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(completedOcrJobPath, `${JSON.stringify({ ...interrupted, state: "running" }, null, 2)}\n`, "utf8");
    adapter.available = false;
    expect(jobs.recoverInterruptedJobs()).toEqual({ requeued: 1, failedRetryable: 0 });

    const recoveredRun = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    const recoveredSource = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as { artifacts: { id: string }[] };
    expect(recoveredRun).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(adapter.callCount).toBe(1);
    expect(new Set(recoveredSource.artifacts.map((artifact) => artifact.id)).size).toBe(recoveredSource.artifacts.length);

    adapter.available = true;
    fs.writeFileSync(path.join(vaultPath, textArtifact.path), "corrupted OCR artifact\n", "utf8");
    const completedAgain = JSON.parse(fs.readFileSync(completedOcrJobPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(completedOcrJobPath, `${JSON.stringify({ ...completedAgain, state: "running" }, null, 2)}\n`, "utf8");
    expect(jobs.recoverInterruptedJobs()).toEqual({ requeued: 1, failedRetryable: 0 });

    const repairedRun = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    expect(repairedRun).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(adapter.callCount).toBe(2);
    expect(fs.readFileSync(path.join(vaultPath, textArtifact.path), "utf8")).toBe("Pige OCR recovered local knowledge.\n");
  });

  it("fails image OCR before adapter execution when the preserved source checksum changes", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult());
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      undefined,
      new OcrService(adapter)
    );
    const imagePath = path.join(path.dirname(vaultPath), "tampered.png");
    const original = Buffer.from("same-size-image-source");
    fs.writeFileSync(imagePath, original);
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(vaultPath, sourceId);
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as { managedCopy: { path: string } };
    const changed = Buffer.from(original);
    changed[0] = changed[0] === 0 ? 1 : changed[0] - 1;
    fs.writeFileSync(path.join(vaultPath, sourceRecord.managedCopy.path), changed);

    const result = await jobs.processQueuedOcr({ sourceIds: [sourceId] });

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(adapter.callCount).toBe(0);
    expect(jobs.list({ classes: ["ocr"], states: ["failed_final"] }).jobs[0]?.message).toContain("cannot be processed safely");
    expect(fs.existsSync(path.join(vaultPath, sourceRecord.managedCopy.path))).toBe(true);
  });

  it("rejects an OCR Source Record that redirects its managed path outside the vault", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult());
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      undefined,
      new OcrService(adapter)
    );
    const imagePath = path.join(path.dirname(vaultPath), "path-escape.png");
    fs.writeFileSync(imagePath, Buffer.from("outside-vault-image"));
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(vaultPath, sourceId);
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      managedCopy: { path: string; checksum: string; size: number };
    } & Record<string, unknown>;
    fs.writeFileSync(sourceRecordPath, `${JSON.stringify({
      ...sourceRecord,
      managedCopy: { ...sourceRecord.managedCopy, path: "../path-escape.png" }
    }, null, 2)}\n`, "utf8");

    const result = await jobs.processQueuedOcr({ sourceIds: [sourceId] });

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(adapter.callCount).toBe(0);
    expect(jobs.list({ classes: ["ocr"], states: ["failed_final"] }).jobs[0]?.message).toContain("cannot be processed safely");
  });

  it("completes empty image OCR with warnings and does not enqueue Agent ingest", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult({
      text: "",
      blocks: [],
      confidence: undefined,
      warnings: ["ocr_empty_text"]
    }));
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      undefined,
      new OcrService(adapter)
    );
    const imagePath = path.join(path.dirname(vaultPath), "empty.png");
    fs.writeFileSync(imagePath, Buffer.from("synthetic-empty-image"));
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitImageOcrJob(vaultPath, sourceId);

    const result = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      artifacts: { kind: string }[];
      metadata: Record<string, unknown>;
    };

    expect(result).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(sourceRecord.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(false);
    expect(sourceRecord.artifacts.some((artifact) => artifact.kind === "metadata")).toBe(true);
    expect(sourceRecord.metadata).toMatchObject({
      parserStatus: "ocr_completed_empty",
      ocrStatus: "completed_empty",
      ocrTextCharacterCount: 0,
      agentTextReady: false,
      ocrWarnings: ["ocr_empty_text"]
    });
    expect(jobs.list({ classes: ["ocr"], states: ["completed_with_warnings"] }).jobs[0]?.sourceId).toBe(sourceId);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("parses preserved DOCX and PPTX files into verified artifacts before OCR and Agent handoff", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault, undefined, undefined, undefined, makeOfficeParser());
    const sourceRoot = path.dirname(vaultPath);
    const docxPath = path.join(sourceRoot, "knowledge.docx");
    const pptxPath = path.join(sourceRoot, "roadmap.pptx");
    fs.writeFileSync(docxPath, await createTestDocx());
    fs.writeFileSync(pptxPath, await createTestPptx());

    const captureResult = await capture.submitFiles({
      filePaths: [docxPath, pptxPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    for (const sourceId of captureResult.sourceIds) seedExplicitPdfParseJob(vaultPath, sourceId);
    expect(jobs.list({ classes: ["parse"], states: ["queued"], limit: 10 }).jobs).toHaveLength(2);

    const parseResult = await jobs.processQueuedParses({ sourceIds: captureResult.sourceIds, limit: 10 });

    expect(parseResult).toMatchObject({ processed: 2, completed: 2, failed: 0 });
    for (const sourceId of captureResult.sourceIds) {
      const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
      const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
        kind: "docx_file" | "pptx_file";
        knowledgePagePath: string;
        artifacts: { kind: string; path: string; checksum?: string; size?: number }[];
        metadata: Record<string, unknown>;
      };
      const textArtifact = requireValue(sourceRecord.artifacts.find((artifact) => artifact.kind === "extracted_text"));
      const metadataArtifact = requireValue(sourceRecord.artifacts.find((artifact) => artifact.kind === "metadata"));
      const extractedText = fs.readFileSync(path.join(vaultPath, textArtifact.path), "utf8");
      const sidecarText = fs.readFileSync(path.join(vaultPath, metadataArtifact.path), "utf8");
      const sourcePageText = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");
      const expectedText = sourceRecord.kind === "docx_file" ? "Local knowledge architecture" : "Roadmap first";

      expect(extractedText).toContain(expectedText);
      expect(sourcePageText).toContain(expectedText);
      expect(sidecarText).not.toContain(expectedText);
      expect(textArtifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(metadataArtifact.checksum).toMatch(/^sha256:[a-f0-9]{64}$/u);
      expect(textArtifact.size).toBe(fs.statSync(path.join(vaultPath, textArtifact.path)).size);
      expect(metadataArtifact.size).toBe(fs.statSync(path.join(vaultPath, metadataArtifact.path)).size);
      expect(sourceRecord.metadata).toMatchObject({
        parserStatus: "parsed_needs_ocr",
        parserId: "office_openxml",
        parserVersion: "1.12.0+5.10.1+3.4.0",
        agentTextReady: true,
        needsOcr: true
      });
    }
    expect(jobs.list({ classes: ["ocr"], limit: 10 }).jobs).toHaveLength(0);
    expect(jobs.list({ classes: ["agent_ingest"], limit: 10 }).jobs).toHaveLength(0);
    expect(jobs.list({ classes: ["parse"], states: ["completed_with_warnings"], limit: 10 }).jobs).toHaveLength(2);
  });

  it("delays PPTX Agent ingest until selected embedded media completes local OCR", async () => {
    const { vaultPath, vault } = makeVault();
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult({
      text: "Screenshot-only roadmap evidence",
      blocks: [{
        text: "Screenshot-only roadmap evidence",
        kind: "line",
        confidence: 0.95,
        boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.12 },
        languageHints: ["en"],
        isTitle: false
      }]
    }));
    const ocr = new OcrService(
      adapter,
      undefined,
      undefined,
      undefined,
      new StaticOfficeMediaMaterializer()
    );
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      undefined,
      undefined,
      undefined,
      makeOfficeParser(),
      ocr
    );
    const pptxPath = path.join(path.dirname(vaultPath), "ocr-roadmap.pptx");
    fs.writeFileSync(pptxPath, await createTestPptx());
    const captured = await capture.submitFiles({
      filePaths: [pptxPath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    seedExplicitPdfParseJob(vaultPath, sourceId);

    const parsed = await jobs.processQueuedParses({ sourceIds: [sourceId] });
    expect(parsed).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(jobs.list({ classes: ["ocr"] }).jobs).toEqual([]);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
    seedExplicitImageOcrJob(vaultPath, sourceId);

    const recognized = await jobs.processQueuedOcr({ sourceIds: [sourceId] });
    const sourceRecord = JSON.parse(fs.readFileSync(
      findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`),
      "utf8"
    )) as { artifacts: { id: string; kind: string }[]; metadata: Record<string, unknown> };
    expect(recognized).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(adapter.callCount).toBe(1);
    expect(sourceRecord.artifacts.some((artifact) => artifact.id.endsWith("_pptx_media_ocr_text"))).toBe(true);
    expect(sourceRecord.metadata).toMatchObject({
      ocrProcessedMediaCount: 1,
      needsOcr: false,
      agentTextReady: true
    });
    expect(jobs.list({ classes: ["ocr"], states: ["completed"] }).jobs[0]?.sourceId).toBe(sourceId);
    expect(jobs.list({ classes: ["agent_ingest"] }).jobs).toEqual([]);
  });

  it("processes queued Agent ingest jobs into wiki notes, operations, index, and log entries", async () => {
    const { vaultPath, vault } = makeVault();
    const agentIngest = new AgentIngestService(
      makeModelPort(),
      new StaticModelClient({
        title: "Generated knowledge note",
        summary: { text: "The Agent compiled a durable wiki note.", evidenceRefs: ["ev_01"] },
        keyPoints: [
          { text: "Source page exists", evidenceRefs: ["ev_01"] },
          { text: "Operation record exists", evidenceRefs: ["ev_01"] }
        ],
        tags: ["agent"],
        topics: ["Ingest"],
        entities: ["Pige"],
        warnings: [],
        confidence: "high"
      })
    );
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captureResult = capture.submitText({
      text: "A source that should become a generated wiki note.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captureResult.sourceId);
    const queued = jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0];
    const processResult = await jobs.processQueuedAgentIngest({ jobIds: queued ? [queued.id] : [] });
    const completed = jobs.list({ classes: ["agent_ingest"], states: ["completed"] }).jobs[0];
    const notePath = findFile(path.join(vaultPath, "wiki"), ".md");
    const note = fs.readFileSync(notePath, "utf8");
    const operation = fs.readFileSync(findFileContaining(path.join(vaultPath, ".pige/operations"), '"kind": "create_page"'), "utf8");
    const index = fs.readFileSync(path.join(vaultPath, "index.md"), "utf8");
    const log = fs.readFileSync(path.join(vaultPath, "log.md"), "utf8");

    expect(processResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(completed?.sourceId).toBe(captureResult.sourceId);
    const completedRecord = JSON.parse(fs.readFileSync(
      findFile(path.join(vaultPath, ".pige/jobs"), `${completed?.id}.json`),
      "utf8"
    )) as { policyContextId?: string; policyHash?: string; operationIds?: string[] };
    expect(completedRecord.policyContextId).toMatch(/^policy_[a-f0-9]{16}$/u);
    expect(completedRecord.policyHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(completedRecord.operationIds).toHaveLength(1);
    expect(note).toContain('type: "note"');
    expect(note).toContain("Generated knowledge note");
    expect(operation).toContain('"kind": "create_page"');
    expect(index).toContain("Generated knowledge note");
    expect(log).toContain("Created wiki note");
  });

  it("completes a historical Agent ingest with a zero-tool Pi final without fabricating durable output", async () => {
    const { vaultPath, vault } = makeVault();
    const assistantText = "Historical assistant text must not be copied into a Job or conversation.";
    const run = vi.fn(async (request: PiAgentRunRequest): Promise<PiAgentRunResult> => {
      await request.beforeModelTurn?.();
      return {
        adapterMode: "embedded_pi_sdk",
        providerProfileId: request.runtimeConfig.provider.id,
        modelProfileId: request.runtimeConfig.model.id,
        modelId: request.runtimeConfig.model.modelId,
        events: [],
        assistantText,
        invokedTools: []
      };
    });
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), { run })
    );
    const captured = capture.submitText({
      text: "A preserved historical source may finish without a knowledge mutation.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captured.sourceId);
    const queued = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);
    const conversationFilesBefore = listFiles(path.join(vaultPath, ".pige", "conversations"));
    const conversationBytesBefore = conversationFilesBefore.map((filePath) => fs.readFileSync(filePath, "utf8"));

    await expect(jobs.processQueuedAgentIngest({ jobIds: [queued.id] }))
      .resolves.toEqual({ processed: 1, completed: 1, failed: 0 });

    const completed = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["completed"] }).jobs[0]);
    const completedBytes = fs.readFileSync(
      findFile(path.join(vaultPath, ".pige", "jobs"), `${completed.id}.json`),
      "utf8"
    );
    expect(run).toHaveBeenCalledTimes(1);
    expect(completed.operationIds ?? []).toEqual([]);
    expect(completed.message).toBe("Historical Agent ingest completed without a durable knowledge effect.");
    expect(readOperationBodies(vaultPath)).toEqual([]);
    expect(listFiles(path.join(vaultPath, ".pige", "conversations"))).toEqual(conversationFilesBefore);
    expect(conversationFilesBefore.map((filePath) => fs.readFileSync(filePath, "utf8")))
      .toEqual(conversationBytesBefore);
    expect(conversationBytesBefore.join("\n")).not.toContain(assistantText);
    expect(completedBytes).not.toContain(assistantText);
  });

  it("cancels Agent ingest cleanly when the request wins before the publication guard", async () => {
    const { vaultPath, vault } = makeVault();
    const modelClient = new BlockingModelClient();
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient)
    );
    const captured = capture.submitText({
      text: "Cancellation should stop this model call before note publication.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captured.sourceId);
    const queued = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);

    const processing = jobs.processQueuedAgentIngest({ jobIds: [queued.id] });
    await modelClient.started.promise;
    const running = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["running"] }).jobs[0]);
    expect(running.stage).toBe("waiting_for_model");
    const request = jobs.cancel({ jobId: running.id });
    expect(request).toMatchObject({ status: "cancel_requested", job: { state: "cancel_requested" } });
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1 });

    const cancelled = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["cancelled"] }).jobs[0]);
    expect(readJobCancellation(vaultPath, cancelled.id)).toMatchObject({
      requestedAt: request.job?.updatedAt,
      requestedBy: "user",
      durableWritesApplied: false
    });
    expect(listFiles(path.join(vaultPath, "wiki", "generated")).filter((filePath) => filePath.endsWith(".md")))
      .toEqual([]);
  });

  it("keeps Agent ingest retryable when note publication fails after the durable guard but before link", async () => {
    const { vaultPath, vault } = makeVault();
    const modelClient = new StaticModelClient(standardAgentOutput("Pre-link publication failure"));
    const agentIngest = new AgentIngestService(makeModelPort(), modelClient);
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captured = capture.submitText({
      text: "The note link must never precede its durable action-safety guard.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captured.sourceId);
    const queued = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);
    vi.spyOn(fs, "linkSync").mockImplementation(() => {
      throw new Error("simulated pre-link failure");
    });

    const result = await jobs.processQueuedAgentIngest({ jobIds: [queued.id] });

    expect(result).toEqual({ processed: 1, completed: 0, failed: 1 });
    const failed = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["failed_retryable"] }).jobs[0]);
    expect(readJobCancellation(vaultPath, failed.id)).toEqual({
      safeCheckpointId: "agent_note_publication_started",
      durableWritesApplied: true
    });
    expect(listFiles(path.join(vaultPath, "wiki", "generated")).filter((filePath) => filePath.endsWith(".md")))
      .toEqual([]);
    expect(jobs.cancel({ jobId: failed.id })).toMatchObject({ status: "not_allowed" });
    const firstPlannedHash = readJobRecord(vaultPath, failed.id).checkpoints?.find(
      (checkpoint) => checkpoint.id === "agent_note_publication_started"
    )?.checksumAfter;
    vi.restoreAllMocks();
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(jobs.retry({ jobId: failed.id }).status).toBe("requeued");
    expect(await jobs.processQueuedAgentIngest({ jobIds: [failed.id] }))
      .toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(modelClient.requests).toHaveLength(2);
    const completedCheckpoint = readJobRecord(vaultPath, failed.id).checkpoints?.find(
      (checkpoint) => checkpoint.id === "agent_note_publication_started"
    );
    expect(firstPlannedHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(completedCheckpoint).toMatchObject({ state: "done" });
    expect(completedCheckpoint?.checksumAfter).not.toBe(firstPlannedHash);
  });

  it("preserves a verified Agent note when cancellation races its create-only commit", async () => {
    const { vaultPath, vault } = makeVault();
    const agentIngest = new AgentIngestService(makeModelPort(), new StaticModelClient(standardAgentOutput(
      "Committed cancellation race"
    )));
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captured = capture.submitText({
      text: "A create-only note that wins the race must remain verifiable.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captured.sourceId);
    const queued = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);
    const originalLink = fs.linkSync.bind(fs);
    let cancelResult: ReturnType<JobsService["cancel"]> | undefined;
    vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      originalLink(existingPath, newPath);
      cancelResult = jobs.cancel({ jobId: queued.id });
    });

    const result = await jobs.processQueuedAgentIngest({ jobIds: [queued.id] });

    expect(cancelResult).toMatchObject({ status: "cancel_requested" });
    expect(result).toEqual({ processed: 1, completed: 1, failed: 0 });
    const completed = requireValue(jobs.list({
      classes: ["agent_ingest"],
      states: ["completed_with_warnings"]
    }).jobs[0]);
    expect(readJobCancellation(vaultPath, completed.id)).toMatchObject({
      requestedBy: "user",
      safeCheckpointId: "agent_note_publication_started",
      durableWritesApplied: true
    });
    expect(completed.message).toContain("Durable output committed");
    expect(fs.readFileSync(findFile(path.join(vaultPath, "wiki", "generated"), ".md"), "utf8"))
      .toContain("Committed cancellation race");
  });

  it("reuses a same-job committed note with a real recovery checkpoint", async () => {
    const { vaultPath, vault } = makeVault();
    const modelClient = new StaticModelClient(standardAgentOutput("Recovered same-job note"));
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient)
    );
    const captured = capture.submitText({
      text: "A restart should attribute this generated note to its exact publishing job.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captured.sourceId);
    const queued = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);
    const originalLink = fs.linkSync.bind(fs);
    vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      originalLink(existingPath, newPath);
      throw new Error("simulated process loss after create-only link");
    });
    expect(await jobs.processQueuedAgentIngest({ jobIds: [queued.id] }))
      .toEqual({ processed: 1, completed: 0, failed: 1 });
    vi.restoreAllMocks();

    const failed = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["failed_retryable"] }).jobs[0]);
    const notePath = findFile(path.join(vaultPath, "wiki", "generated"), ".md");
    const noteHash = checksumText(fs.readFileSync(notePath, "utf8"));
    const guardedJob = readJobRecord(vaultPath, failed.id);
    expect(guardedJob.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "agent_note_publication_started",
        step: "agent_note_publication_started",
        state: "running",
        checksumAfter: noteHash,
        inputRefs: [
          expect.objectContaining({
            kind: "source",
            id: failed.sourceId,
            checksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            role: "publication_source_revision"
          }),
          {
            kind: "tool",
            id: guardedJob.policyContextId,
            checksum: guardedJob.policyHash,
            role: "publication_policy"
          }
        ],
        outputRefs: [
          expect.objectContaining({
            kind: "page",
            path: path.relative(vaultPath, notePath).split(path.sep).join("/"),
            checksum: noteHash,
            role: "expected_generated_note"
          }),
          expect.objectContaining({
            kind: "operation",
            path: expect.stringMatching(/^\.pige\/operations\//u),
            role: "expected_create_operation"
          })
        ]
      })
    ]));
    expect(jobs.retry({ jobId: failed.id }).status).toBe("requeued");
    expect(await jobs.processQueuedAgentIngest({ jobIds: [failed.id] }))
      .toEqual({ processed: 1, completed: 1, failed: 0 });

    const completed = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["completed"] }).jobs[0]);
    expect(readJobCancellation(vaultPath, completed.id)).toEqual({
      safeCheckpointId: "agent_existing_note_adoption_started",
      durableWritesApplied: true
    });
    expect(readJobRecord(vaultPath, completed.id).checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "agent_note_publication_started",
        state: "done",
        checksumAfter: noteHash,
        finishedAt: expect.any(String)
      })
    ]));
    expect(modelClient.requests).toHaveLength(1);
    const createOperation = readOperationBodies(vaultPath)
      .map((body) => JSON.parse(body) as { readonly kind?: string; readonly id?: string; readonly after?: unknown })
      .find((operation) => operation.kind === "create_page");
    expect(createOperation?.after).toEqual(expect.objectContaining({ id: noteHash }));
    const activity = new KnowledgeActivityService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    });
    expect(activity.list().activities.find((item) => item.operationId === createOperation?.id))
      .toMatchObject({ canUndo: true });
  });

  it("preserves an external edit made after a create link but before recovery", async () => {
    const { vaultPath, vault } = makeVault();
    const modelClient = new StaticModelClient(standardAgentOutput("Recovery conflict note"));
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient)
    );
    const captured = capture.submitText({
      text: "A recovery-window edit must remain authoritative.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captured.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captured.sourceId);
    const queued = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);
    const originalLink = fs.linkSync.bind(fs);
    vi.spyOn(fs, "linkSync").mockImplementation((existingPath, newPath) => {
      originalLink(existingPath, newPath);
      throw new Error("simulated process loss after create link");
    });
    expect(await jobs.processQueuedAgentIngest({ jobIds: [queued.id] }))
      .toEqual({ processed: 1, completed: 0, failed: 1 });
    vi.restoreAllMocks();

    const failed = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["failed_retryable"] }).jobs[0]);
    const notePath = findFile(path.join(vaultPath, "wiki", "generated"), ".md");
    fs.appendFileSync(notePath, "\nUser edit made before restart recovery.\n", "utf8");
    expect(jobs.retry({ jobId: failed.id }).status).toBe("requeued");

    expect(await jobs.processQueuedAgentIngest({ jobIds: [failed.id] }))
      .toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(fs.readFileSync(notePath, "utf8")).toContain("User edit made before restart recovery.");
    expect(readOperationBodies(vaultPath).some((body) => body.includes('"kind": "create_page"')))
      .toBe(false);
    expect(fs.readFileSync(path.join(vaultPath, "index.md"), "utf8")).not.toContain("Recovery conflict note");
    expect(modelClient.requests).toHaveLength(1);
  });

  it("requeues Agent ingest when SourceRecord changes at the final note commit fence", async () => {
    const { vaultPath, vault } = makeVault();
    let modelReturned = false;
    const modelClient = new StaticModelClient({
      title: "Stale generated note",
      summary: { text: "This response must not survive a source revision change.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    }, () => {
      modelReturned = true;
    });
    const { capture, jobs } = makeServices(
      vaultPath,
      vault,
      new AgentIngestService(makeModelPort(), modelClient)
    );
    const captureResult = capture.submitText({
      text: "The durable source revision must fence the final generated-note commit.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captureResult.sourceId);
    const queued = jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0];
    const sourceRecordPath = findFile(
      path.join(vaultPath, ".pige", "source-records"),
      `${captureResult.sourceId}.json`
    );
    const originalFsync = fs.fsyncSync.bind(fs);
    let changedAtCommit = false;
    const fsyncSpy = vi.spyOn(fs, "fsyncSync").mockImplementation((descriptor) => {
      if (modelReturned && !changedAtCommit) {
        const current = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
          metadata: Record<string, unknown>;
        };
        current.metadata = {
          ...current.metadata,
          concurrentRevision: "after_model_before_note_commit"
        };
        fs.writeFileSync(sourceRecordPath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
        changedAtCommit = true;
      }
      originalFsync(descriptor);
    });

    let processResult: Awaited<ReturnType<JobsService["processQueuedAgentIngest"]>>;
    try {
      processResult = await jobs.processQueuedAgentIngest({ jobIds: queued ? [queued.id] : [] });
    } finally {
      fsyncSpy.mockRestore();
    }

    const requeued = jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0];
    const operationBodies = listFiles(path.join(vaultPath, ".pige", "operations"))
      .map((filePath) => fs.readFileSync(filePath, "utf8"));
    expect(processResult).toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(changedAtCommit).toBe(true);
    expect(modelClient.requests).toHaveLength(1);
    expect(requeued?.sourceId).toBe(captureResult.sourceId);
    expect(requeued?.message).toContain("requeued with the latest evidence");
    expect(requeued ? readJobCancellation(vaultPath, requeued.id) : undefined).toBeUndefined();
    expect(listFiles(path.join(vaultPath, "wiki", "generated")).filter((filePath) => filePath.endsWith(".md")))
      .toEqual([]);
    expect(operationBodies.some((body) => body.includes('"kind": "create_page"'))).toBe(false);
  });

  it("keeps provider failures clean-cancellable before Agent publication", async () => {
    const providerFixture = makeVault();
    const providerServices = makeServices(
      providerFixture.vaultPath,
      providerFixture.vault,
      new AgentIngestService(makeModelPort(), new StaticModelClient(
        standardAgentOutput("Provider failure note"),
        () => {
          throw new PigeDomainError("model_provider.network_failed", "Synthetic provider failure.");
        }
      ))
    );
    const providerCapture = providerServices.capture.submitText({
      text: "A provider failure before publication must not set the durable guard.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    providerServices.jobs.processQueuedCaptures({ jobIds: [providerCapture.jobId] });
    seedHistoricalAgentIngestJob(providerFixture.vaultPath, providerCapture.sourceId);
    const providerJob = requireValue(providerServices.jobs.list({
      classes: ["agent_ingest"],
      states: ["queued"]
    }).jobs[0]);
    expect(await providerServices.jobs.processQueuedAgentIngest({ jobIds: [providerJob.id] }))
      .toEqual({ processed: 1, completed: 0, failed: 1 });
    const failed = requireValue(providerServices.jobs.list({
      classes: ["agent_ingest"],
      states: ["failed_retryable"]
    }).jobs[0]);
    expect(readJobCancellation(providerFixture.vaultPath, failed.id)).toBeUndefined();
    expect(providerServices.jobs.cancel({ jobId: failed.id }).status).toBe("cancelled");
  });

  it("marks low-confidence Agent ingest jobs as completed with warnings", async () => {
    const { vaultPath, vault } = makeVault();
    const agentIngest = new AgentIngestService(
      makeModelPort(),
      new StaticModelClient({
        title: "Review needed note",
        summary: { text: "The Agent produced a note that should be checked.", evidenceRefs: ["ev_01"] },
        keyPoints: [{ text: "Review before trusting", evidenceRefs: ["ev_01"] }],
        tags: [],
        topics: [],
        entities: [],
        warnings: ["The evidence is incomplete."],
        confidence: "low"
      })
    );
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captureResult = capture.submitText({
      text: "A thin source that should not become clean knowledge.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    seedHistoricalAgentIngestJob(vaultPath, captureResult.sourceId);
    const queued = jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0];
    const processResult = await jobs.processQueuedAgentIngest({ jobIds: queued ? [queued.id] : [] });
    const warningJob = jobs.list({ classes: ["agent_ingest"], states: ["completed_with_warnings"] }).jobs[0];
    const notePath = findFile(path.join(vaultPath, "wiki"), ".md");
    const note = fs.readFileSync(notePath, "utf8");
    const log = fs.readFileSync(path.join(vaultPath, "log.md"), "utf8");

    expect(processResult).toEqual({ processed: 1, completed: 1, failed: 0 });
    expect(warningJob?.sourceId).toBe(captureResult.sourceId);
    expect(warningJob?.message).toContain("needs review");
    expect(note).toContain('status: "needs_review"');
    expect(note).toContain('review_state: "needs_review"');
    expect(log).toContain("Review is needed before treating it as clean knowledge.");
    expect(jobs.list({ classes: ["agent_ingest"], states: ["completed"] }).jobs).toHaveLength(0);
  });

  it("requeues waiting Agent ingest jobs after a default model becomes ready", async () => {
    const { vaultPath, vault } = makeVault();
    let configured = false;
    const agentIngest = new AgentIngestService(
      makeModelPort(() => (configured ? runtimeConfig : undefined)),
      new StaticModelClient({
        title: "Late model note",
        summary: { text: "The waiting job resumed after model setup.", evidenceRefs: ["ev_01"] },
        keyPoints: [{ text: "Resumed", evidenceRefs: ["ev_01"] }],
        tags: [],
        topics: [],
        entities: [],
        warnings: [],
        confidence: "medium"
      })
    );
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captureResult = capture.submitText({
      text: "This capture waits for a model.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    const historical = seedHistoricalAgentIngestJob(vaultPath, captureResult.sourceId);
    expect(await jobs.processQueuedAgentIngest({ jobIds: [historical.id] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(readJobRecord(vaultPath, historical.id)).toMatchObject({
      state: "waiting_dependency",
      waitingDependency: { dependencyKind: "model_provider" }
    });

    configured = true;
    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 1 });
    const queued = jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0];
    await jobs.processQueuedAgentIngest({ jobIds: queued ? [queued.id] : [] });

    expect(jobs.list({ classes: ["agent_ingest"], states: ["completed"] }).jobs[0]?.sourceId).toBe(captureResult.sourceId);
  });

  it("requeues the same historical Agent Job only after its referenced original is verified again", async () => {
    const { vaultPath } = makeVault();
    const vault = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const sourcePath = path.join(path.dirname(vaultPath), "reconnected-source.md");
    const sourceBody = "# Reconnected source\n\nExact historical evidence.\n";
    fs.writeFileSync(sourcePath, sourceBody, "utf8");
    const agentIngest = new AgentIngestService(
      makeModelPort(() => runtimeConfig),
      new StaticModelClient(standardAgentOutput("Reconnected historical source"))
    );
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    const sourceId = requireFirst(captureResult.sourceIds);
    const historical = seedHistoricalAgentIngestJob(vaultPath, sourceId);
    fs.unlinkSync(sourcePath);

    expect(await jobs.processQueuedAgentIngest({ jobIds: [historical.id] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(readJobRecord(vaultPath, historical.id)).toMatchObject({
      state: "waiting_dependency",
      waitingDependency: {
        dependencyKind: "external_source",
        dependencyId: sourceId,
        requiredAction: "reconnect_path"
      }
    });
    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });

    fs.writeFileSync(sourcePath, sourceBody, "utf8");
    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 1 });
    expect(readJobRecord(vaultPath, historical.id).state).toBe("queued");
  });

  it("does not reinterpret a historical Agent wait owned by a non-model dependency", () => {
    const { vaultPath, vault } = makeVault();
    const agentIngest = new AgentIngestService(
      makeModelPort(() => runtimeConfig),
      new StaticModelClient(standardAgentOutput("Unused historical wait"))
    );
    const { capture, jobs } = makeServices(vaultPath, vault, agentIngest);
    const captureResult = capture.submitText({
      text: "This historical turn is waiting for an exact local tool owner.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    const waiting = seedHistoricalAgentIngestJob(vaultPath, captureResult.sourceId, "waiting_dependency");
    const waitingPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${waiting.id}.json`);
    fs.writeFileSync(waitingPath, `${JSON.stringify(JobRecordSchema.parse({
      ...waiting,
      waitingDependency: {
        dependencyKind: "local_tool",
        dependencyId: "ocr:image_file",
        requiredAction: "repair_tool",
        messageKey: "errors.agent_runtime.tool_dependency_waiting"
      }
    }), null, 2)}\n`, "utf8");

    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });
    expect(readJobRecord(vaultPath, waiting.id)).toMatchObject({
      state: "waiting_dependency",
      waitingDependency: { dependencyKind: "local_tool", dependencyId: "ocr:image_file" }
    });
  });

  it("rejects an obsolete Agent Job that is not bound to a normalized historical source", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "A current Agent-turn source must not enter historical compatibility processing.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    jobs.processQueuedCaptures({ jobIds: [captureResult.jobId] });
    const sourcePath = findFile(
      path.join(vaultPath, ".pige", "source-records"),
      `${captureResult.sourceId}.json`
    );
    const source = JSON.parse(fs.readFileSync(sourcePath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(sourcePath, `${JSON.stringify({
      ...source,
      semanticOrchestration: "agent_turn"
    }, null, 2)}\n`, "utf8");
    const historical = seedHistoricalAgentIngestJob(vaultPath, captureResult.sourceId);

    expect(await jobs.processQueuedAgentIngest({ jobIds: [historical.id] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(readJobRecord(vaultPath, historical.id)).toMatchObject({
      state: "failed_final",
      message: "This obsolete Agent ingest record is not bound to a normalized historical source."
    });
  });

  it("requeues the same historical Agent parent when its exact selected parser child becomes ready", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "waiting-selected-parser.pdf");
    fs.writeFileSync(sourcePath, createTestPdf(["Selected parser recovery fixture."]));
    const initial = makeServices(vaultPath, vault);
    const captureResult = await initial.capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    initial.jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    const parent = seedHistoricalAgentIngestJob(vaultPath, sourceId, "waiting_dependency");
    const child = seedWaitingAgentParseChild(vaultPath, parent, sourceId);
    const agentIngest = new AgentIngestService(
      makeModelPort(() => runtimeConfig),
      new StaticModelClient(standardAgentOutput("Unused selected parser recovery"))
    );
    const { jobs } = makeServices(
      vaultPath,
      vault,
      agentIngest,
      undefined,
      undefined,
      makePdfParser()
    );

    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 1 });
    expect(readJobRecord(vaultPath, parent.id).state).toBe("queued");
    expect(readJobRecord(vaultPath, child.id)).toMatchObject({
      state: "waiting_dependency",
      parentJobId: parent.id,
      sourceId
    });
    expect(listJobRecords(vaultPath).filter((job) => job.parentJobId === parent.id)).toHaveLength(1);
  });

  it("does not requeue a historical Agent parent from an unrelated ready child", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "waiting-selected-ocr.pdf");
    fs.writeFileSync(sourcePath, createTestPdf(["Selected OCR dependency fixture."]));
    const initial = makeServices(vaultPath, vault);
    const captureResult = await initial.capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    initial.jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    const parent = seedHistoricalAgentIngestJob(vaultPath, sourceId, "waiting_dependency");
    const parserChild = seedWaitingAgentParseChild(vaultPath, parent, sourceId);
    const ocrChild = seedWaitingAgentOcrChild(vaultPath, parent.id, sourceId);
    const agentIngest = new AgentIngestService(
      makeModelPort(() => runtimeConfig),
      new StaticModelClient(standardAgentOutput("Must remain waiting for OCR"))
    );
    const { jobs } = makeServices(
      vaultPath,
      vault,
      agentIngest,
      undefined,
      undefined,
      makePdfParser()
    );

    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });
    expect(readJobRecord(vaultPath, parent.id)).toMatchObject({
      state: "waiting_dependency",
      waitingDependency: { dependencyId: ocrChild.id }
    });
    expect(readJobRecord(vaultPath, parserChild.id).state).toBe("waiting_dependency");
    expect(readJobRecord(vaultPath, ocrChild.id).state).toBe("waiting_dependency");
  });

  it("binds a historical Agent wait to the exact child reported by the current tool execution", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "exact-selected-child.pdf");
    fs.writeFileSync(sourcePath, createTestPdf(["Exact selected child fixture."]));
    const initial = makeServices(vaultPath, vault);
    const captureResult = await initial.capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    initial.jobs.processQueuedCaptures({ jobIds: captureResult.jobIds });
    const parent = seedHistoricalAgentIngestJob(vaultPath, sourceId);
    const selectedChild = seedWaitingAgentParseChild(vaultPath, parent, sourceId);
    const unrelatedNewerChild = seedWaitingAgentOcrChild(vaultPath, parent.id, sourceId);
    const agentIngest = {
      ingestSource: async () => {
        throw new AgentToolDependencyWaitingError(selectedChild.id);
      }
    } as unknown as AgentIngestService;
    const { jobs } = makeServices(vaultPath, vault, agentIngest);

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parent.id] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(readJobRecord(vaultPath, parent.id)).toMatchObject({
      state: "waiting_dependency",
      waitingDependency: {
        dependencyKind: "local_tool",
        dependencyId: selectedChild.id
      }
    });
    expect(readJobRecord(vaultPath, unrelatedNewerChild.id).state).toBe("waiting_dependency");
  });

  it("creates Markdown file source pages without inlining large bodies", async () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const sourcePath = path.join(path.dirname(vaultPath), "long.md");
    const largeMarkdown = `# Long Markdown\n\n${"long-source-line\n".repeat(500)}`;
    fs.writeFileSync(sourcePath, largeMarkdown, "utf8");
    const captureResult = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captureResult.sourceIds);
    const jobId = requireFirst(captureResult.jobIds);

    jobs.processQueuedCaptures({ jobIds: [jobId] });

    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      knowledgePagePath: string;
    };
    const sourcePage = fs.readFileSync(path.join(vaultPath, sourceRecord.knowledgePagePath), "utf8");

    expect(sourceRecord.knowledgePagePath).toMatch(/^sources\/files\/\d{4}\/src_/);
    expect(sourcePage).toContain("Long Markdown");
    expect(sourcePage).toContain("complete body is preserved in the managed source copy");
    expect(sourcePage).not.toContain(largeMarkdown);
  });

  it("cancels queued jobs without deleting preserved sources", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "Preserved before cancellation.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    const cancelResult = jobs.cancel({ jobId: captureResult.jobId });
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${captureResult.sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as { managedCopy: { path: string } };
    const managedSourcePath = path.join(vaultPath, sourceRecord.managedCopy.path);
    const listedJob = jobs.list({ states: ["cancelled"] }).jobs[0];

    expect(cancelResult.status).toBe("cancelled");
    expect(listedJob?.state).toBe("cancelled");
    expect(readJobCancellation(vaultPath, captureResult.jobId)?.durableWritesApplied).toBe(false);
    expect(fs.existsSync(sourceRecordPath)).toBe(true);
    expect(fs.readFileSync(managedSourcePath, "utf8")).toBe("Preserved before cancellation.");
  });

  it("requeues cancelled jobs and refuses to retry already queued jobs", () => {
    const { vaultPath, vault } = makeVault();
    const { capture, jobs } = makeServices(vaultPath, vault);
    const captureResult = capture.submitText({
      text: "Retry me later.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    expect(jobs.retry({ jobId: captureResult.jobId }).status).toBe("not_allowed");
    expect(jobs.cancel({ jobId: captureResult.jobId }).status).toBe("cancelled");

    const retryResult = jobs.retry({ jobId: captureResult.jobId });
    const listedJob = jobs.list({ states: ["queued"] }).jobs[0];

    expect(retryResult.status).toBe("requeued");
    expect(listedJob?.id).toBe(captureResult.jobId);
    expect(listedJob?.state).toBe("queued");
  });

  it("converges repeated same-Job retries to a newer retryable terminal state each time", () => {
    const { vaultPath, vault } = makeVault();
    const jobs = new JobsService({ current: () => vault, activeVaultPath: () => vaultPath });
    const created = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260716_retrysettles1",
      conversationLocator: ".pige/conversations/2026/07/conv_20260716_retrysettles1.jsonl",
      inputHash: `sha256:${"c".repeat(64)}`
    });
    const fail = (job: JobRecord): JobRecord => jobs.settleAgentTurnJob(
      jobs.beginAgentTurnJob(job, { stage: "planning", message: "Retry attempt started." }),
      {
        kind: "requeue",
        error: {
          code: "model_provider.call_failed",
          domain: "model_provider",
          messageKey: "errors.model_provider.call_failed",
          retryable: true,
          severity: "error",
          userAction: "retry"
        },
        reason: "model_provider.call_failed",
        maxAutomaticRetries: 0,
        requiresUserAction: true,
        message: "The provider call failed retryably."
      }
    );

    const firstFailure = fail(created);
    expect(jobs.retry({ jobId: created.id }).status).toBe("requeued");
    const firstQueued = requireValue(jobs.readAgentTurnJob(created.id));
    const secondFailure = fail(firstQueued);
    expect(jobs.retry({ jobId: created.id }).status).toBe("requeued");
    const secondQueued = requireValue(jobs.readAgentTurnJob(created.id));

    expect(firstFailure.state).toBe("failed_retryable");
    expect(secondFailure.state).toBe("failed_retryable");
    expect(secondQueued.state).toBe("queued");
    expect(Date.parse(firstQueued.updatedAt)).toBeGreaterThan(Date.parse(firstFailure.updatedAt));
    expect(Date.parse(secondFailure.updatedAt)).toBeGreaterThan(Date.parse(firstQueued.updatedAt));
    expect(Date.parse(secondQueued.updatedAt)).toBeGreaterThan(Date.parse(secondFailure.updatedAt));
    expect(secondFailure.id).toBe(firstFailure.id);
    expect(secondFailure.error?.code).toBe("model_provider.call_failed");
  });

  it("records worker-backed index progress before completing SQLite search rebuild", async () => {
    const { vaultPath, vault } = makeVault();
    const database = makeInlineWorkerDatabase();
    const { jobs } = makeServices(vaultPath, vault, undefined, database);
    writePage(vaultPath, "wiki/index-job.md", {
      id: "page_20260710_indexjob",
      title: "Index Job",
      body: "Durable index rebuild jobs make local search recoverable."
    });

    const rebuild = await jobs.requestIndexRebuild();
    const listedJob = jobs.list({ classes: ["index_rebuild"], states: ["completed"] }).jobs[0];
    const search = database.searchPages(vaultPath, { query: "recoverable search" });
    const log = fs.readFileSync(path.join(vaultPath, "log.md"), "utf8");

    expect(rebuild.jobId).toMatch(/^job_\d{8}_[a-z0-9]{8,}$/);
    expect(rebuild.state).toBe("completed");
    expect(rebuild.pageCount).toBe(1);
    expect(listedJob?.id).toBe(rebuild.jobId);
    expect(listedJob?.message).toContain("Index rebuilt from Markdown");
    expect(listedJob?.progress).toEqual({
      completedUnits: 3,
      totalUnits: 3,
      unit: "index_item"
    });
    expect(readJobCancellation(vaultPath, rebuild.jobId)).toBeUndefined();
    expect(search?.results[0]?.summary.title).toBe("Index Job");
    expect(log).toContain("Rebuilt local database index from Markdown");
  });

  it("cooperatively cancels a running index worker without changing durable Markdown", async () => {
    const { vaultPath, vault } = makeVault();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const rebuilder: LocalDatabaseRebuildPort = {
      rebuild: (_activeVaultPath, options = {}) => new Promise((_resolve, reject) => {
        options.onProgress?.({ completedUnits: 0, totalUnits: 5, unit: "index_item" });
        options.signal?.addEventListener("abort", () => reject(new JobCancellationError()), { once: true });
        markStarted?.();
      })
    };
    const database = new LocalDatabaseService(new NodeSqliteDriver(), rebuilder);
    const { jobs } = makeServices(vaultPath, vault, undefined, database);
    writePage(vaultPath, "wiki/cancel-index.md", {
      id: "page_20260711_cancelindex",
      title: "Cancel Index",
      body: "Durable Markdown remains untouched when its derived index worker is cancelled."
    });

    const rebuilding = jobs.requestIndexRebuild();
    await started;
    const runningJob = jobs.list({ classes: ["index_rebuild"], states: ["running"] }).jobs[0];
    expect(runningJob?.progress).toEqual({ completedUnits: 0, totalUnits: 5, unit: "index_item" });
    expect(jobs.cancel({ jobId: requireValue(runningJob).id }).status).toBe("cancel_requested");

    await expect(rebuilding).rejects.toMatchObject({ code: "index_rebuild_failed" });
    const cancelled = jobs.list({ classes: ["index_rebuild"], states: ["cancelled"] }).jobs[0];
    expect(cancelled?.id).toBe(runningJob?.id);
    expect(readJobCancellation(vaultPath, requireValue(cancelled).id)).toMatchObject({
      requestedBy: "user",
      safeCheckpointId: "before_durable_write",
      durableWritesApplied: false
    });
    expect(fs.readFileSync(path.join(vaultPath, "wiki/cancel-index.md"), "utf8"))
      .toContain("Durable Markdown remains untouched");
  });

  it("serializes concurrent index rebuild requests through one process-local writer", async () => {
    const { vaultPath, vault } = makeVault();
    let active = 0;
    let maxActive = 0;
    let sequence = 0;
    const rebuilder: LocalDatabaseRebuildPort = {
      rebuild: async (_activeVaultPath, options = {}) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        const current = ++sequence;
        options.onProgress?.({ completedUnits: 0, totalUnits: 1, unit: "index_item" });
        await new Promise<void>((resolve) => setImmediate(resolve));
        options.onProgress?.({ completedUnits: 1, totalUnits: 1, unit: "index_item" });
        active -= 1;
        return {
          rebuiltAt: `2026-07-11T00:00:0${current}.000Z`,
          pageCount: 0,
          invalidPageCount: 0
        };
      }
    };
    const database = new LocalDatabaseService(new NodeSqliteDriver(), rebuilder);
    const { jobs } = makeServices(vaultPath, vault, undefined, database);

    const results = await Promise.all([
      jobs.requestIndexRebuild(),
      jobs.requestIndexRebuild()
    ]);

    expect(maxActive).toBe(1);
    expect(results.map((result) => result.pageCount)).toEqual([0, 0]);
    expect(jobs.list({ classes: ["index_rebuild"], states: ["completed"] }).jobs).toHaveLength(2);
  });
});

function findFile(root: string, suffix: string): string {
  const found = findFileOptional(root, suffix);
  if (!found) throw new Error(`Missing file ending with ${suffix}`);
  return found;
}

function replaceLogWithDirectory(vaultPath: string): void {
  const logPath = path.join(vaultPath, "log.md");
  fs.rmSync(logPath, { force: true });
  fs.mkdirSync(logPath);
}

function findFileContaining(root: string, marker: string): string {
  for (const filePath of listFiles(root)) {
    if (fs.readFileSync(filePath, "utf8").includes(marker)) return filePath;
  }
  throw new Error(`Missing file containing ${marker}`);
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : entry.isFile() ? [fullPath] : [];
  });
}

function makePdfParser(): PdfParserService {
  return new PdfParserService({
    extract: (filePath) => extractPdfText({
      requestId: "jobs-test",
      filePath,
      limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
    })
  });
}

function makeOfficeParser(): DocumentParserService {
  return new DocumentParserService([
    new OfficeParserService({
      extract: (filePath, sourceKind) => extractOfficeText({
        requestId: "jobs-office-test",
        filePath,
        sourceKind,
        limits: {
          maxBytes: OFFICE_PARSER_MAX_BYTES,
          maxEntries: OFFICE_PARSER_MAX_ENTRIES,
          maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
          maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
          maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
          maxSlides: OFFICE_PARSER_MAX_SLIDES,
          maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS
        }
      })
    })
  ]);
}

function makeInlineWorkerDatabase(): LocalDatabaseService {
  const driver = new NodeSqliteDriver();
  const rebuilder: LocalDatabaseRebuildPort = {
    rebuild: async (vaultPath, options = {}) => {
      options.signal?.throwIfAborted();
      const result = driver.rebuild(vaultPath, { onProgress: options.onProgress });
      options.signal?.throwIfAborted();
      return result;
    }
  };
  return new LocalDatabaseService(driver, rebuilder);
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}

async function waitForValue<T>(read: () => T | undefined): Promise<T> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for value.");
}

function seedExplicitPdfParseJob(vaultPath: string, sourceId: string): JobRecord {
  const parent = requireValue(listJobRecords(vaultPath).find((job) =>
    job.class === "capture" && job.sourceId === sourceId
  ));
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1] ?? "20260711";
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const jobId = `job_${dateKey}_${suffix}pa`;
  const now = "2026-07-11T00:00:00.000Z";
  const existing = listJobRecords(vaultPath).find((job) => job.id === jobId);
  const child = existing ?? JobRecordSchema.parse({
    id: jobId,
    class: "parse",
    state: "queued",
    parentJobId: parent.id,
    createdAt: now,
    updatedAt: now,
    sourceId,
    ...(parent.captureId ? { captureId: parent.captureId } : {}),
    ...(parent.conversationEventId ? { conversationEventId: parent.conversationEventId } : {}),
    message: "Explicit parser-substrate test Job queued."
  });
  if (!existing) {
    const childPath = path.join(
      vaultPath,
      ".pige",
      "jobs",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${jobId}.json`
    );
    fs.mkdirSync(path.dirname(childPath), { recursive: true });
    fs.writeFileSync(childPath, `${JSON.stringify(child, null, 2)}\n`, "utf8");
  }
  if (!(parent.childJobIds ?? []).includes(child.id)) {
    const parentPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${parent.id}.json`);
    const linkedParent = JobRecordSchema.parse({
      ...parent,
      childJobIds: [...(parent.childJobIds ?? []), child.id],
      updatedAt: now
    });
    fs.writeFileSync(parentPath, `${JSON.stringify(linkedParent, null, 2)}\n`, "utf8");
  }
  return child;
}

function seedExplicitImageOcrJob(
  vaultPath: string,
  sourceId: string,
  state: "queued" | "waiting_dependency" = "queued"
): JobRecord {
  const parent = requireValue(listJobRecords(vaultPath).find((job) =>
    job.class === "capture" && job.sourceId === sourceId
  ));
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1] ?? "20260711";
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const jobId = `job_${dateKey}_${suffix}oa`;
  const now = "2026-07-11T00:00:00.000Z";
  const existing = listJobRecords(vaultPath).find((job) => job.id === jobId);
  const child = existing ?? JobRecordSchema.parse({
    id: jobId,
    class: "ocr",
    state,
    parentJobId: parent.id,
    createdAt: now,
    updatedAt: now,
    sourceId,
    ...(state === "waiting_dependency" ? {
      waitingDependency: {
        dependencyKind: "local_tool",
        dependencyId: "ocr:image_file",
        requiredAction: "repair_tool",
        messageKey: "errors.agent_runtime.tool_dependency_waiting"
      }
    } : {}),
    ...(parent.captureId ? { captureId: parent.captureId } : {}),
    ...(parent.conversationEventId ? { conversationEventId: parent.conversationEventId } : {}),
    message: state === "waiting_dependency"
      ? "Persisted image OCR fixture is waiting for local OCR capability."
      : "Persisted image OCR fixture queued."
  });
  if (!existing) {
    const childPath = path.join(
      vaultPath,
      ".pige",
      "jobs",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${jobId}.json`
    );
    fs.mkdirSync(path.dirname(childPath), { recursive: true });
    fs.writeFileSync(childPath, `${JSON.stringify(child, null, 2)}\n`, "utf8");
  }
  if (!(parent.childJobIds ?? []).includes(child.id)) {
    const parentPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${parent.id}.json`);
    const linkedParent = JobRecordSchema.parse({
      ...parent,
      childJobIds: [...(parent.childJobIds ?? []), child.id],
      updatedAt: now
    });
    fs.writeFileSync(parentPath, `${JSON.stringify(linkedParent, null, 2)}\n`, "utf8");
  }
  return child;
}

function seedHistoricalAgentIngestJob(
  vaultPath: string,
  sourceId: string,
  state: "queued" | "waiting_dependency" = "queued"
): JobRecord {
  const parent = requireValue(listJobRecords(vaultPath).find((job) =>
    job.class === "capture" && job.sourceId === sourceId
  ));
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1] ?? "20260711";
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const jobId = `job_${dateKey}_${suffix}ag`;
  const now = "2026-07-11T00:00:00.000Z";
  const existing = listJobRecords(vaultPath).find((job) => job.id === jobId);
  const child = existing ?? JobRecordSchema.parse({
    id: jobId,
    class: "agent_ingest",
    state,
    parentJobId: parent.id,
    createdAt: now,
    updatedAt: now,
    sourceId,
    activeVaultId: parent.activeVaultId,
    ...(state === "waiting_dependency" ? {
      waitingDependency: {
        dependencyKind: "model_provider",
        requiredAction: "configure_model",
        messageKey: "errors.model_provider.default_model_missing"
      }
    } : {}),
    ...(parent.captureId ? { captureId: parent.captureId } : {}),
    ...(parent.conversationEventId ? { conversationEventId: parent.conversationEventId } : {}),
    message: state === "waiting_dependency"
      ? "Historical Agent ingest is waiting for a tested default model."
      : "Historical Agent ingest fixture queued."
  });
  if (!existing) {
    const childPath = path.join(
      vaultPath,
      ".pige",
      "jobs",
      dateKey.slice(0, 4),
      dateKey.slice(4, 6),
      `${jobId}.json`
    );
    fs.mkdirSync(path.dirname(childPath), { recursive: true });
    fs.writeFileSync(childPath, `${JSON.stringify(child, null, 2)}\n`, "utf8");
  }
  if (!(parent.childJobIds ?? []).includes(child.id)) {
    const parentPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${parent.id}.json`);
    fs.writeFileSync(parentPath, `${JSON.stringify(JobRecordSchema.parse({
      ...parent,
      childJobIds: [...(parent.childJobIds ?? []), child.id],
      updatedAt: now
    }), null, 2)}\n`, "utf8");
  }
  return child;
}

function seedWaitingAgentParseChild(
  vaultPath: string,
  parent: JobRecord,
  sourceId: string
): JobRecord {
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1] ?? "20260711";
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const now = "2026-07-11T00:00:00.000Z";
  const child = JobRecordSchema.parse({
    id: `job_${dateKey}_${suffix}pt`,
    class: "parse",
    state: "waiting_dependency",
    parentJobId: parent.id,
    createdAt: now,
    updatedAt: now,
    sourceId,
    waitingDependency: {
      dependencyKind: "local_tool",
      dependencyId: "pige_parse_source",
      requiredAction: "repair_tool",
      messageKey: "errors.agent_runtime.tool_dependency_waiting"
    },
    inputRefs: [{
      kind: "tool",
      id: "pige_parse_source@1",
      checksum: `sha256:${"a".repeat(64)}`,
      role: "agent_tool_canonical_input"
    }],
    message: "Selected parser child is waiting for its exact local capability."
  });
  const childPath = path.join(
    vaultPath,
    ".pige",
    "jobs",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${child.id}.json`
  );
  fs.mkdirSync(path.dirname(childPath), { recursive: true });
  fs.writeFileSync(childPath, `${JSON.stringify(child, null, 2)}\n`, "utf8");
  const parentPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${parent.id}.json`);
  fs.writeFileSync(parentPath, `${JSON.stringify(JobRecordSchema.parse({
    ...parent,
    waitingDependency: child.waitingDependency,
    childJobIds: [...new Set([...(parent.childJobIds ?? []), child.id])],
    updatedAt: now
  }), null, 2)}\n`, "utf8");
  return child;
}

function seedWaitingAgentOcrChild(
  vaultPath: string,
  parentJobId: string,
  sourceId: string
): JobRecord {
  const parent = readJobRecord(vaultPath, parentJobId);
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1] ?? "20260711";
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const now = "2026-07-11T00:00:01.000Z";
  const child = JobRecordSchema.parse({
    id: `job_${dateKey}_${suffix}ot`,
    class: "ocr",
    state: "waiting_dependency",
    parentJobId,
    createdAt: now,
    updatedAt: now,
    sourceId,
    waitingDependency: {
      dependencyKind: "local_tool",
      dependencyId: "pige_ocr_source",
      requiredAction: "repair_tool",
      messageKey: "errors.agent_runtime.tool_dependency_waiting"
    },
    inputRefs: [{
      kind: "tool",
      id: "pige_ocr_source@1",
      checksum: `sha256:${"b".repeat(64)}`,
      role: "agent_tool_canonical_input"
    }],
    message: "Selected OCR child is waiting for its exact local capability."
  });
  const childPath = path.join(
    vaultPath,
    ".pige",
    "jobs",
    dateKey.slice(0, 4),
    dateKey.slice(4, 6),
    `${child.id}.json`
  );
  fs.mkdirSync(path.dirname(childPath), { recursive: true });
  fs.writeFileSync(childPath, `${JSON.stringify(child, null, 2)}\n`, "utf8");
  const parentPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${parent.id}.json`);
  fs.writeFileSync(parentPath, `${JSON.stringify(JobRecordSchema.parse({
    ...parent,
    waitingDependency: {
      dependencyKind: "local_tool",
      dependencyId: child.id,
      requiredAction: "repair_tool",
      messageKey: "errors.agent_runtime.tool_dependency_waiting"
    },
    childJobIds: [...new Set([...(parent.childJobIds ?? []), child.id])],
    updatedAt: now
  }), null, 2)}\n`, "utf8");
  return child;
}

function readJobRecord(vaultPath: string, jobId: string): JobRecord {
  const jobPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${jobId}.json`);
  return JSON.parse(fs.readFileSync(jobPath, "utf8")) as JobRecord;
}

function checksumText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function listJobRecords(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"))
    .filter((filePath) => filePath.endsWith(".json"))
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function readJobCancellation(vaultPath: string, jobId: string): {
  readonly requestedAt?: string;
  readonly requestedBy?: string;
  readonly safeCheckpointId?: string;
  readonly durableWritesApplied?: boolean;
} | undefined {
  const jobPath = findFile(path.join(vaultPath, ".pige", "jobs"), `${jobId}.json`);
  const job = JSON.parse(fs.readFileSync(jobPath, "utf8")) as {
    readonly cancellation?: { readonly durableWritesApplied?: boolean };
  };
  return job.cancellation;
}

function readOperationBodies(vaultPath: string): string[] {
  return listFiles(path.join(vaultPath, ".pige", "operations"))
    .map((filePath) => fs.readFileSync(filePath, "utf8"));
}

function standardAgentOutput(title: string): unknown {
  return {
    title,
    summary: { text: "Grounded Agent output for an action-safety test.", evidenceRefs: ["ev_01"] },
    keyPoints: [{ text: "Publication stays create-only", evidenceRefs: ["ev_01"] }],
    tags: [],
    topics: [],
    entities: [],
    warnings: [],
    confidence: "high"
  };
}

function findFileOptional(root: string, suffix: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return undefined;
}

function requireFirst(values: readonly string[]): string {
  const first = values[0];
  if (!first) throw new Error("Expected at least one value.");
  return first;
}

function writePage(vaultPath: string, relativePath: string, input: {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly type?: string;
  readonly language?: string;
}): void {
  const filePath = path.join(vaultPath, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${input.id}"
schema_version: 1
title: "${input.title}"
type: "${input.type ?? "note"}"
created_at: "2026-07-10T12:00:00.000Z"
updated_at: "2026-07-10T12:00:00.000Z"
status: "active"
language: "${input.language ?? "en"}"
source_ids: []
---

${input.body}
`, "utf8");
}

class StaticModelClient extends ScriptedAgentIngestRuntime {
  readonly requests: Array<{ readonly user: string; readonly signal?: AbortSignal }> = [];

  constructor(
    output: unknown,
    onRequest?: () => void | Promise<void>
  ) {
    super(output, onRequest);
  }

  protected override async onInspectionReady(request: PiAgentRunRequest): Promise<void> {
    this.requests.push({
      user: this.userPrompt,
      ...(request.signal ? { signal: request.signal } : {})
    });
  }
}

class BlockingModelClient {
  readonly started = deferred<void>();

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    await request.beforeModelTurn?.();
    this.started.resolve();
    return new Promise((_resolve, reject) => {
      const rejectAbort = (): void => {
        const error = new Error("model request cancelled");
        error.name = "AbortError";
        reject(error);
      };
      if (request.signal?.aborted) {
        rejectAbort();
      } else {
        request.signal?.addEventListener("abort", rejectAbort, { once: true });
      }
    });
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class StaticPdfPageRenderer implements PdfPageRendererPort {
  callCount = 0;
  readonly requestedPageSets: number[][] = [];
  readonly inputPaths: string[] = [];

  constructor(private readonly incomplete = false) {}

  isAvailable(): boolean {
    return true;
  }

  async renderPages(filePath: string, pageCandidates: readonly number[]): Promise<PdfPageRendererResult> {
    this.callCount += 1;
    this.inputPaths.push(filePath);
    const requestedPages = [...pageCandidates];
    this.requestedPageSets.push(requestedPages);
    const renderedPages = this.incomplete ? [] : requestedPages;
    const pages = renderedPages.map((page) => {
      const png = Uint8Array.from(Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
      ));
      return {
        requestedPage: page,
        renderedPage: page,
        locator: `page:${page}`,
        mimeType: "image/png" as const,
        png,
        width: 1,
        height: 1,
        pngByteSize: png.byteLength
      };
    });
    return {
      protocolVersion: PDF_PAGE_RENDERER_PROTOCOL_VERSION,
      rendererId: PDF_PAGE_RENDERER_ID,
      rendererVersion: PDF_PAGE_RENDERER_VERSION,
      pageCount: requestedPages.at(-1) ?? 1,
      requestedPages,
      renderedPages,
      pages,
      totalPngByteSize: pages.reduce((total, page) => total + page.pngByteSize, 0),
      warnings: this.incomplete ? [{ code: "page_render_failed", page: requestedPages[0] ?? 1 }] : [],
      truncated: this.incomplete
    };
  }
}

class StaticNativeOcrAdapter implements NativeImageOcrAdapterPort {
  callCount = 0;
  readonly inputPaths: string[] = [];

  constructor(
    readonly result: NativeOcrResult,
    public available = true
  ) {}

  isAvailable(): boolean {
    return this.available;
  }

  async recognize(inputPath: string): Promise<NativeOcrResult> {
    this.callCount += 1;
    this.inputPaths.push(inputPath);
    return this.result;
  }
}

class StaticOfficeMediaMaterializer implements OfficeMediaMaterializerPort {
  isAvailable(): boolean {
    return true;
  }

  async materialize(_filePath: string, targets: readonly OfficeMediaTarget[]) {
    return {
      materializerId: OFFICE_MEDIA_MATERIALIZER_ID,
      materializerVersion: OFFICE_MEDIA_MATERIALIZER_VERSION,
      media: targets.map((target) => ({ ...target, bytes: Uint8Array.from(TINY_PNG) }))
    };
  }
}

function validNativeOcrResult(overrides: Partial<NativeOcrResult> = {}): NativeOcrResult {
  return {
    engine: "macos_vision_document",
    engineVersion: "revision1",
    adapterVersion: "1.0.0",
    text: "Pige OCR recovered local knowledge.",
    blocks: [{
      text: "Pige OCR recovered local knowledge.",
      kind: "line",
      confidence: 0.94,
      boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.12 },
      languageHints: ["en"],
      isTitle: true
    }],
    languageHints: ["en"],
    confidence: 0.94,
    warnings: [],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 1600,
      sourceHeight: 500,
      decodedWidth: 1600,
      decodedHeight: 500,
      downsampled: false
    },
    ...overrides
  };
}
