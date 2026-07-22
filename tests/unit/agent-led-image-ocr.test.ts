import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import type { JobRecord, OperationRecord, SourceRecord } from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestCapabilityPort,
  type AgentIngestModelConfigPort,
  type AgentIngestRuntimePort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  OcrService,
  type NativeImageOcrAdapterPort
} from "../../apps/desktop/src/main/services/ocr-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
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
    id: "provider_image_tool",
    displayName: "Image Tool Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_image_tool",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_image_tool",
    providerProfileId: "provider_image_tool",
    modelId: "image-tool-model",
    displayName: "Image Tool Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-image-tool-key"
};

const modelPort: AgentIngestModelConfigPort = {
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent-led image OCR tool", () => {
  it("runs Pi inspect -> OCR -> inspect -> publish for a preserved image", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "knowledge.png");
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("Verified image knowledge."));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: completeImageTrace(groundedOutput("Agent-selected image knowledge"), "success")
    }));
    const jobs = makeJobs(fixture, runtime, new OcrService(adapter), true);

    expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "ocr")).toEqual([]);

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });

    const parent = readJob(fixture.vaultPath, parentId);
    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    const source = readSource(fixture.vaultPath, captured.sourceId);
    const note = fs.readFileSync(
      requireValue(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]),
      "utf8"
    );

    expect(runtime.results[0]?.invokedTools).toEqual([
      "pige_inspect_source",
      "pige_ocr_source",
      "pige_inspect_source",
      "pige_create_knowledge_note"
    ]);
    expect(parent).toMatchObject({ state: "completed", childJobIds: [child.id] });
    expect(child).toMatchObject({ state: "completed", parentJobId: parent.id, sourceId: captured.sourceId });
    expect(child.inputRefs?.find((ref) => ref.role === "agent_tool_canonical_input")?.checksum)
      .toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(child)).not.toContain("image_success_ocr");
    expect(adapter.callCount).toBe(1);
    expect(source.metadata).toMatchObject({
      ocrStatus: "completed",
      needsOcr: false,
      agentTextReady: true
    });
    expect(source.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(true);
    expect(note).toContain("# Agent-selected image knowledge");
    expect(note).toContain(`[source:${captured.sourceId}#ocr1]`);
    expect(readOperations(fixture.vaultPath).some((operation) =>
      operation.kind === "create_artifact" && operation.jobId === child.id
    )).toBe(true);
  });

  it("keeps an image parent parked without a child until OCR capability becomes ready", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "waiting.png");
    const waitingRuntime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [toolCall("pige_inspect_source", "image_wait_inspect")]
    }));
    const waitingJobs = makeJobs(fixture, waitingRuntime, undefined, false);
    waitingJobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(waitingJobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await waitingJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(readJob(fixture.vaultPath, parentId).state).toBe("waiting_dependency");
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "ocr")).toEqual([]);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(waitingJobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });

    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("Recovered image evidence."));
    const resumedRuntime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: completeImageTrace(groundedOutput("Recovered image knowledge"), "resume")
    }));
    const resumedJobs = makeJobs(fixture, resumedRuntime, new OcrService(adapter), true);

    expect(resumedJobs.requeueWaitingAgentIngest()).toEqual({ requeued: 1 });
    expect(await resumedJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "ocr");
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ state: "completed", parentJobId: parentId });
    expect(adapter.callCount).toBe(1);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toHaveLength(1);
  });

  it("reuses one image OCR child and artifact operation across parent retry", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "retry.png");
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("One image OCR action survives retry."));
    const runtime = new SequencedRuntime([
      [
        toolCall("pige_inspect_source", "image_retry_inspect_first"),
        toolCall("pige_ocr_source", "image_retry_ocr_first"),
        { kind: "text", text: "Synthetic interruption after durable image OCR." }
      ],
      completeImageTrace(groundedOutput("Retried image knowledge"), "retry_second")
    ]);
    const jobs = makeJobs(fixture, runtime, new OcrService(adapter), true);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 0, failed: 1 });
    const firstChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    const firstArtifactOperations = readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_artifact")
      .map((operation) => operation.id);

    expect(jobs.retry({ jobId: parentId })).toMatchObject({ status: "requeued" });
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 1, failed: 0 });

    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "ocr");
    expect(children).toHaveLength(1);
    expect(children[0]?.id).toBe(firstChild.id);
    expect(children[0]?.inputRefs?.filter((ref) => ref.role === "agent_tool_call_provenance")).toHaveLength(2);
    expect(adapter.callCount).toBe(1);
    expect(readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_artifact")
      .map((operation) => operation.id)).toEqual(firstArtifactOperations);
    expect(readJob(fixture.vaultPath, parentId).childJobIds).toEqual([firstChild.id]);
  });

  it("waits without publishing when selected image OCR returns no readable evidence", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "empty.png");
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("", {
      blocks: [],
      confidence: undefined,
      warnings: ["ocr_empty_text"]
    }));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "image_empty_inspect"),
        toolCall("pige_ocr_source", "image_empty_ocr")
      ]
    }));
    const jobs = makeJobs(fixture, runtime, new OcrService(adapter), true);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    expect(readJob(fixture.vaultPath, parentId)).toMatchObject({
      state: "waiting_dependency",
      childJobIds: [child.id]
    });
    expect(child.state).toBe("completed_with_warnings");
    expect(readSource(fixture.vaultPath, captured.sourceId).metadata).toMatchObject({
      ocrStatus: "completed_empty",
      agentTextReady: false
    });
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });

    const restartedJobs = makeJobs(
      fixture,
      new RecordingRuntime(new PiAgentRuntimeAdapter({ fauxResponses: [] })),
      new OcrService(adapter),
      true
    );
    expect(restartedJobs.requeueWaitingAgentIngest()).toEqual({ requeued: 0 });
    expect(readJob(fixture.vaultPath, parentId)).toMatchObject({
      state: "waiting_dependency",
      childJobIds: [child.id]
    });
    expect(adapter.callCount).toBe(1);
  });

  it("propagates parent cancellation into the active image OCR child", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "cancel.png");
    const started = deferred<void>();
    const adapter = new BlockingNativeOcrAdapter(started.resolve);
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "image_cancel_inspect"),
        toolCall("pige_ocr_source", "image_cancel_ocr")
      ]
    }));
    const jobs = makeJobs(fixture, runtime, new OcrService(adapter), true);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    const processing = jobs.processQueuedAgentIngest({ jobIds: [parentId] });
    await started.promise;

    expect(jobs.cancel({ jobId: parentId })).toMatchObject({ status: "cancel_requested" });
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1 });

    const parent = readJob(fixture.vaultPath, parentId);
    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    expect(parent).toMatchObject({
      state: "failed_retryable",
      cancellation: { requestedBy: "user", durableWritesApplied: true }
    });
    expect(child).toMatchObject({
      state: "cancelled",
      parentJobId: parent.id,
      cancellation: { durableWritesApplied: false }
    });
    expect(readSource(fixture.vaultPath, captured.sourceId).artifacts).toEqual([]);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
  });

  it("rejects a parser call for an image before creating any child or note", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "wrong-tool.png");
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("Must not run."));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "image_wrong_tool_inspect"),
        toolCall("pige_parse_source", "image_wrong_tool_parse")
      ]
    }));
    const jobs = makeJobs(fixture, runtime, new OcrService(adapter), true);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 0,
      failed: 1
    });
    expect(readJob(fixture.vaultPath, parentId).state).toBe("failed_retryable");
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "parse" || job.class === "ocr")).toEqual([]);
    expect(adapter.callCount).toBe(0);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
  });

  it("preserves an image without OCR when no model runtime is ready", async () => {
    const fixture = makeVault();
    const captured = await preserveImage(fixture, "no-model.png");
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("Must remain unused."));
    const jobs = new JobsService(fixture.vaultPort, undefined, undefined, undefined, new OcrService(adapter));

    expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(jobs.list({ classes: ["agent_ingest"], states: ["waiting_dependency"] }).jobs).toHaveLength(1);
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "ocr")).toEqual([]);
    expect(adapter.callCount).toBe(0);
    expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
  });
});

class RecordingRuntime implements AgentIngestRuntimePort {
  readonly results: PiAgentRunResult[] = [];

  constructor(private readonly delegate: AgentIngestRuntimePort) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    const result = await this.delegate.run(request);
    this.results.push(result);
    return result;
  }
}

class SequencedRuntime implements AgentIngestRuntimePort {
  #next = 0;

  constructor(private readonly responses: readonly (readonly PiFauxResponse[])[]) {}

  async run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    const fauxResponses = requireValue(this.responses[this.#next]);
    this.#next += 1;
    return new PiAgentRuntimeAdapter({ fauxResponses }).run(request);
  }
}

class StaticNativeOcrAdapter implements NativeImageOcrAdapterPort {
  callCount = 0;

  constructor(private readonly result: NativeOcrResult) {}

  isAvailable(): boolean {
    return true;
  }

  async recognize(): Promise<NativeOcrResult> {
    this.callCount += 1;
    return this.result;
  }
}

class BlockingNativeOcrAdapter implements NativeImageOcrAdapterPort {
  constructor(private readonly onStart: () => void) {}

  isAvailable(): boolean {
    return true;
  }

  recognize(_inputPath: string, _languages: readonly string[], signal?: AbortSignal): Promise<NativeOcrResult> {
    this.onStart();
    return new Promise((_resolve, reject) => {
      const cancel = (): void => reject(new JobCancellationError());
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

function makeJobs(
  fixture: ReturnType<typeof makeVault>,
  runtime: AgentIngestRuntimePort,
  ocr: OcrService | undefined,
  ocrReady: boolean
): JobsService {
  return new JobsService(
    fixture.vaultPort,
    new AgentIngestService(modelPort, runtime, capabilityPort(ocrReady)),
    undefined,
    undefined,
    ocr
  );
}

function capabilityPort(ocrReady: boolean): AgentIngestCapabilityPort {
  return {
    snapshot: () => ({
      localDatabaseStatus: "not_initialized",
      parserToolchainReady: false,
      ocrEngines: ocrReady ? ["apple_vision"] : [],
      speechInputAvailable: false,
      embeddingModelInstalled: false,
      lexicalSearchAvailable: false,
      vectorSearchAvailable: false,
      rerankerAvailable: false
    })
  };
}

function completeImageTrace(output: unknown, suffix: string): readonly PiFauxResponse[] {
  return [
    toolCall("pige_inspect_source", `image_${suffix}_inspect_before`),
    toolCall("pige_ocr_source", `image_${suffix}_ocr`),
    toolCall("pige_inspect_source", `image_${suffix}_inspect_after`),
    toolCall("pige_create_knowledge_note", `image_${suffix}_publish`, output)
  ];
}

function toolCall(toolName: string, toolCallId: string, args: unknown = {}): PiFauxResponse {
  return { kind: "tool_call", toolName, args, toolCallId };
}

function groundedOutput(title: string) {
  return {
    title,
    summary: {
      text: "The image was recognized only after the Agent selected the bounded local OCR tool.",
      evidenceRefs: ["ev_01"]
    },
    keyPoints: [{
      text: "The generated note remains grounded in locator-bearing OCR evidence.",
      evidenceRefs: ["ev_01"]
    }],
    tags: ["image"],
    topics: ["Agent-led OCR"],
    entities: [],
    warnings: [],
    confidence: "high"
  };
}

function validNativeOcrResult(text: string, overrides: Partial<NativeOcrResult> = {}): NativeOcrResult {
  return {
    engine: "macos_vision_document",
    engineVersion: "revision1",
    adapterVersion: "1.0.0",
    text,
    blocks: text ? [{
      text,
      kind: "line",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.12 },
      languageHints: ["en"],
      isTitle: true
    }] : [],
    languageHints: ["en"],
    confidence: text ? 0.95 : undefined,
    warnings: [],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 800,
      sourceHeight: 600,
      decodedWidth: 800,
      decodedHeight: 600,
      downsampled: false
    },
    ...overrides
  };
}

async function preserveImage(
  fixture: ReturnType<typeof makeVault>,
  fileName: string
): Promise<{
  readonly sourceId: string;
  readonly captureJobId: string;
  readonly managedPath: string;
  readonly bytes: Buffer;
}> {
  const bytes = Buffer.from(`synthetic preserved image: ${fileName}`);
  const sourcePath = path.join(path.dirname(fixture.vaultPath), fileName);
  fs.writeFileSync(sourcePath, bytes);
  const captured = await new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath).submitFiles({
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-image-tool-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentImageTool",
    appDataPath: path.join(root, "app-data")
  });
  const vaultPath = path.join(root, "AgentImageTool");
  return {
    vaultPath,
    vaultPort: {
      current: () => loadVaultSummary(vaultPath),
      activeVaultPath: () => vaultPath
    }
  };
}

function readJobs(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function readJob(vaultPath: string, jobId: string): JobRecord {
  return requireValue(readJobs(vaultPath).find((job) => job.id === jobId));
}

function readSource(vaultPath: string, sourceId: string): SourceRecord {
  const filePath = requireValue(listFiles(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`)[0]);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as SourceRecord;
}

function readOperations(vaultPath: string): OperationRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "operations"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord);
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

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
