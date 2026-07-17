import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { JobRecordSchema, type JobRecord, type OperationRecord, type SourceRecord } from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestCapabilityPort,
  type AgentIngestModelConfigPort,
  type AgentIngestRuntimePort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { DatasetService, type DatasetImportPlanner } from "../../apps/desktop/src/main/services/dataset-service";
import type { DatasetIngestPlan } from "../../apps/desktop/src/main/services/dataset-ingest-types";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  PiAgentRuntimeAdapter,
  type PiAgentRunRequest,
  type PiAgentRunResult,
  type PiFauxResponse
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { markSourceAsLegacyAgentIngestFixture } from "../helpers/legacy-agent-ingest-fixture";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_dataset_tool",
    displayName: "Dataset Tool Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_dataset_tool",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z"
  },
  model: {
    id: "model_dataset_tool",
    providerProfileId: "provider_dataset_tool",
    modelId: "dataset-tool-model",
    displayName: "Dataset Tool Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z"
  },
  apiKey: "synthetic-dataset-tool-key"
};

const modelPort: AgentIngestModelConfigPort = {
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

const capabilities: AgentIngestCapabilityPort = {
  snapshot: () => ({
    localDatabaseStatus: "not_initialized",
    parserToolchainReady: false,
    datasetToolchainReady: true,
    ocrEngines: [],
    speechInputAvailable: false,
    embeddingModelInstalled: false,
    lexicalSearchAvailable: false,
    vectorSearchAvailable: false,
    rerankerAvailable: false
  })
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent-selected Dataset ingest tool", () => {
  it("runs Pi inspect -> Dataset materialization and terminates without a hidden note pipeline", async () => {
    const fixture = makeVault();
    const captured = await preserveCsv(fixture);
    const planner = new StaticPlanner(csvPlan(captured.bytes));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "dataset_inspect_1"),
        toolCall("pige_inspect_dataset", "dataset_materialize_1")
      ]
    }));
    const jobs = makeJobs(fixture, runtime, planner);

    expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "dataset_import")).toEqual([]);
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    const outcome = await jobs.processQueuedAgentIngest({ jobIds: [parentId] });
    expect({ outcome, jobs: readJobs(fixture.vaultPath) }).toMatchObject({
      outcome: { processed: 1, completed: 1, failed: 0 }
    });

    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "dataset_import"));
    const parent = readJob(fixture.vaultPath, parentId);
    const source = readSource(fixture.vaultPath, captured.sourceId);
    expect(runtime.results[0]?.invokedTools).toEqual(["pige_inspect_source", "pige_inspect_dataset"]);
    expect(parent).toMatchObject({ state: "completed", childJobIds: [child.id] });
    expect(child).toMatchObject({ state: "completed", parentJobId: parentId, sourceId: captured.sourceId });
    expect(child.outputRefs?.map((ref) => ref.kind)).toEqual(expect.arrayContaining(["dataset", "dataset_revision"]));
    expect(child.inputRefs?.filter((ref) => ref.role === "agent_tool_call_provenance")).toHaveLength(1);
    expect(JSON.stringify(child)).not.toContain("dataset_materialize_1");
    expect(source.metadata).toMatchObject({ parserStatus: "dataset_materialized", datasetTableCount: 1, datasetRowCount: 2 });
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toHaveLength(1);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_dataset_revision"))
      .toHaveLength(1);
    expect(planner.callCount).toBe(1);
  });

  it("reuses one deterministic child, Bundle, and Operation after parent restart-equivalent retry", async () => {
    const fixture = makeVault();
    const captured = await preserveCsv(fixture);
    const planner = new StaticPlanner(csvPlan(captured.bytes));
    const firstJobs = makeJobs(fixture, new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "dataset_retry_inspect_1"),
        toolCall("pige_inspect_dataset", "dataset_retry_materialize_1")
      ]
    })), planner);
    firstJobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(firstJobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    await firstJobs.processQueuedAgentIngest({ jobIds: [parentId] });
    const firstChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "dataset_import"));
    const firstOperationIds = readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_dataset_revision")
      .map((operation) => operation.id);
    const parentPath = findFile(path.join(fixture.vaultPath, ".pige/jobs"), `${parentId}.json`);
    const completedParent = readJob(fixture.vaultPath, parentId);
    const { finishedAt: _finishedAt, progress: _progress, ...retryableParent } = completedParent;
    fs.writeFileSync(parentPath, `${JSON.stringify(JobRecordSchema.parse({
      ...retryableParent,
      state: "failed_retryable",
      updatedAt: "2026-07-13T01:00:00.000Z",
      message: "Simulated crash after child commit before parent completion."
    }), null, 2)}\n`, "utf8");

    const resumedJobs = makeJobs(fixture, new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "dataset_retry_inspect_2"),
        toolCall("pige_inspect_dataset", "dataset_retry_materialize_2")
      ]
    })), planner);
    expect(resumedJobs.retry({ jobId: parentId })).toMatchObject({ status: "requeued" });
    expect(await resumedJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 1, failed: 0 });

    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "dataset_import");
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(firstChild.id);
    expect(children[0]?.inputRefs?.filter((ref) => ref.role === "agent_tool_call_provenance")).toHaveLength(2);
    expect(planner.callCount).toBe(1);
    expect(readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_dataset_revision")
      .map((operation) => operation.id)).toEqual(firstOperationIds);
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toHaveLength(1);
  });

  it("preserves a structured source without creating a Dataset child when no model is ready", async () => {
    const fixture = makeVault();
    const captured = await preserveCsv(fixture);
    const planner = new StaticPlanner(csvPlan(captured.bytes));
    const jobs = new JobsService(
      fixture.vaultPort,
      undefined,
      undefined,
      undefined,
      undefined,
      new DatasetService(planner)
    );
    expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toMatchObject({ completed: 1, failed: 0 });
    expect(jobs.list({ classes: ["agent_ingest"], states: ["waiting_dependency"] }).jobs).toHaveLength(1);
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "dataset_import")).toEqual([]);
    expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
    expect(planner.callCount).toBe(0);
  });

  it("requeues a waiting Agent parent when Dataset capability becomes ready and reuses its child", async () => {
    const fixture = makeVault();
    const captured = await preserveCsv(fixture);
    const planner = new StaticPlanner(csvPlan(captured.bytes), false);
    const waitingJobs = makeJobs(fixture, new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "dataset_wait_inspect"),
        toolCall("pige_inspect_dataset", "dataset_wait_materialize")
      ]
    })), planner);
    waitingJobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(waitingJobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await waitingJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    const waitingChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "dataset_import"));
    expect(waitingChild.state).toBe("waiting_dependency");
    expect(readJob(fixture.vaultPath, parentId).state).toBe("waiting_dependency");
    expect(waitingJobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });

    planner.available = true;
    const resumedJobs = makeJobs(fixture, new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "dataset_resume_inspect"),
        toolCall("pige_inspect_dataset", "dataset_resume_materialize")
      ]
    })), planner);
    expect(resumedJobs.requeueWaitingAgentIngest()).toEqual({ requeued: 1 });
    expect(await resumedJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 1, failed: 0 });
    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "dataset_import");
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(waitingChild.id);
    expect(planner.callCount).toBe(1);
  });

  it("propagates parent cancellation into the active Dataset child before bundle commit", async () => {
    const fixture = makeVault();
    const captured = await preserveCsv(fixture);
    const started = deferred<void>();
    const planner = new BlockingPlanner(started.resolve);
    const jobs = makeJobs(fixture, new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "dataset_cancel_inspect"),
        toolCall("pige_inspect_dataset", "dataset_cancel_materialize")
      ]
    })), planner);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    const processing = jobs.processQueuedAgentIngest({ jobIds: [parentId] });
    await started.promise;

    expect(jobs.cancel({ jobId: parentId })).toMatchObject({ status: "cancel_requested" });
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1 });
    const parent = readJob(fixture.vaultPath, parentId);
    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "dataset_import"));
    expect(parent).toMatchObject({
      state: "cancelled",
      cancellation: { requestedBy: "user", durableWritesApplied: false }
    });
    expect(child).toMatchObject({
      state: "cancelled",
      parentJobId: parentId,
      cancellation: { durableWritesApplied: false }
    });
    expect(fs.readdirSync(path.join(fixture.vaultPath, "datasets"))).toEqual([]);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_dataset_revision"))
      .toEqual([]);
  });
});

class StaticPlanner implements DatasetImportPlanner {
  callCount = 0;

  constructor(private readonly result: DatasetIngestPlan, public available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async plan(): Promise<DatasetIngestPlan> {
    this.callCount += 1;
    return this.result;
  }
}

class BlockingPlanner implements DatasetImportPlanner {
  constructor(private readonly onStart: () => void) {}

  isAvailable(): boolean {
    return true;
  }

  plan(_filePath: string, _sourceKind: DatasetIngestPlan["source"]["kind"], signal?: AbortSignal): Promise<DatasetIngestPlan> {
    this.onStart();
    return new Promise((_resolve, reject) => {
      const cancel = (): void => reject(new JobCancellationError());
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

class RecordingRuntime implements AgentIngestRuntimePort {
  readonly results: PiAgentRunResult[] = [];

  constructor(private readonly delegate: AgentIngestRuntimePort) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    const result = await this.delegate.run(request);
    this.results.push(result);
    return result;
  }
}

function makeJobs(
  fixture: ReturnType<typeof makeVault>,
  runtime: AgentIngestRuntimePort,
  planner: DatasetImportPlanner
): JobsService {
  return new JobsService(
    fixture.vaultPort,
    new AgentIngestService(modelPort, runtime, capabilities),
    undefined,
    undefined,
    undefined,
    new DatasetService(planner)
  );
}

function toolCall(toolName: string, toolCallId: string): PiFauxResponse {
  return { kind: "tool_call", toolName, args: {}, toolCallId };
}

async function preserveCsv(fixture: ReturnType<typeof makeVault>) {
  const bytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
  const sourcePath = path.join(path.dirname(fixture.vaultPath), "records.csv");
  fs.writeFileSync(sourcePath, bytes);
  const captured = await new CaptureService(fixture.vaultPort).submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(captured.sourceIds[0]);
  markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, sourceId);
  const source = readSource(fixture.vaultPath, sourceId);
  return {
    sourceId,
    captureJobId: requireValue(captured.jobIds[0]),
    managedPath: path.join(fixture.vaultPath, requireValue(source.managedCopy).path),
    bytes
  };
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-dataset-tool-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentDatasetTool",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  const vaultPath = path.join(root, "AgentDatasetTool");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

function csvPlan(bytes: Buffer): DatasetIngestPlan {
  const values = [["Ada", "3"], ["Grace", "5"]];
  return {
    schemaVersion: 1,
    planner: { id: "dataset_ingest", version: "1" },
    source: {
      kind: "csv_file",
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      encoding: "utf-8",
      bom: false,
      delimiter: ",",
      quote: "\"",
      nullTokens: ["NULL", "\\N"],
      lineEndings: ["lf"]
    },
    target: { profile: "managed_collection", owner: "dataset_service", sourceDisposition: "preserve_as_evidence" },
    limits: {
      maxSourceBytes: 1024 * 1024,
      maxRows: 100,
      maxColumns: 10,
      maxCells: 1000,
      maxCellBytes: 1024,
      maxPlanValueBytes: 1024 * 1024,
      maxTables: 10,
      maxArchiveEntries: 100,
      maxArchiveUncompressedBytes: 1024 * 1024,
      maxXmlEntryBytes: 1024 * 1024,
      maxSelectedXmlBytes: 1024 * 1024
    },
    stats: { tableCount: 1, rowCount: 2, columnCount: 2, cellCount: 4, retainedValueBytes: 10 },
    tables: [{
      ordinal: 1,
      sourceName: "records",
      sourceLocator: "csv:table:1",
      sourceMetadata: { delimiter: "," },
      header: {
        mode: "auto",
        used: true,
        sourceRow: {
          ordinal: 0,
          sourceRow: 1,
          cells: [
            { columnOrdinal: 1, state: "value", sourceType: "csv.text", lexical: { raw: "name", text: "name", quoted: false }, projection: { kind: "text", value: "name" } },
            { columnOrdinal: 2, state: "value", sourceType: "csv.text", lexical: { raw: "count", text: "count", quoted: false }, projection: { kind: "text", value: "count" } }
          ]
        }
      },
      columns: [
        { ordinal: 1, sourceName: "name", suggestedName: "name", projectedType: "text", sourceTypes: ["csv.text"], stats: { missing: 0, empty: 0, null: 0, value: 2 } },
        { ordinal: 2, sourceName: "count", suggestedName: "count", projectedType: "integer", sourceTypes: ["csv.integer"], stats: { missing: 0, empty: 0, null: 0, value: 2 } }
      ],
      rows: values.map((row, index) => ({
        ordinal: index + 1,
        sourceRow: index + 2,
        cells: [
          { columnOrdinal: 1, state: "value", sourceType: "csv.text", lexical: { raw: row[0]!, text: row[0]!, quoted: false }, projection: { kind: "text", value: row[0]! } },
          { columnOrdinal: 2, state: "value", sourceType: "csv.integer", lexical: { raw: row[1]!, text: row[1]!, quoted: false }, projection: { kind: "integer", value: row[1]! } }
        ]
      }))
    }],
    warnings: []
  };
}

function readJob(vaultPath: string, jobId: string): JobRecord {
  return JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige/jobs"), `${jobId}.json`), "utf8")) as JobRecord;
}

function readJobs(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige/jobs"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function readSource(vaultPath: string, sourceId: string): SourceRecord {
  return JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`), "utf8")) as SourceRecord;
}

function readOperations(vaultPath: string): OperationRecord[] {
  return listFiles(path.join(vaultPath, ".pige/operations"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord);
}

function findFile(root: string, suffix: string): string {
  const match = listFiles(root, suffix)[0];
  if (!match) throw new Error(`Missing file ending ${suffix}`);
  return match;
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    return entry.isDirectory()
      ? listFiles(filePath, suffix)
      : entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  }).sort();
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
