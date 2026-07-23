import { createHash } from "node:crypto";
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
  type NativeImageOcrAdapterPort,
  type OcrPort
} from "../../apps/desktop/src/main/services/ocr-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
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
  PiAgentRuntimeAdapter,
  type PiAgentRunRequest,
  type PiAgentRunResult,
  type PiFauxResponse
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { markSourceAsLegacyAgentIngestFixture } from "../helpers/legacy-agent-ingest-fixture";
import { createJpegScanPdf } from "./helpers/pdf-image-fixture";
import { createTestPdf } from "./helpers/pdf-fixture";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_pdf_ocr_tool",
    displayName: "PDF OCR Tool Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_pdf_ocr_tool",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_pdf_ocr_tool",
    providerProfileId: "provider_pdf_ocr_tool",
    modelId: "pdf-ocr-tool-model",
    displayName: "PDF OCR Tool Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-pdf-ocr-tool-key"
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

describe("Agent-led PDF OCR tool", { timeout: 15_000 }, () => {
  it("runs Pi inspect -> parse -> OCR -> inspect -> publish for an image-only PDF", async () => {
    const fixture = makeVault();
    const captured = await preservePdf(fixture, "agent-scan.pdf", createJpegScanPdf(1));
    const parser = makePdfParser();
    const renderer = new StaticPdfPageRenderer();
    const adapter = new StaticNativeOcrAdapter(nativeOcrResult("Agent-selected OCR recovered durable scan evidence."));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: completeOcrTrace(
        "scan",
        groundedOutput("Agent-selected OCR knowledge", ["ev_01"]),
        true
      )
    }));
    const jobs = makeJobs(fixture, runtime, parser, new OcrService(adapter, undefined, renderer));
    const network = installNetworkTripwire();

    try {
      jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
      const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

      expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });

      const parent = readJob(fixture.vaultPath, parentId);
      const parseChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
      const ocrChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
      const source = readSource(fixture.vaultPath, captured.sourceId);
      const note = fs.readFileSync(
        requireValue(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]),
        "utf8"
      );
      const operations = readOperations(fixture.vaultPath);

      expect(runtime.results[0]?.invokedTools).toEqual([
        "pige_inspect_source",
        "pige_parse_source",
        "pige_ocr_source",
        "pige_inspect_source",
        "pige_create_knowledge_note",
        "pige_ocr_source"
      ]);
      expect(parent).toMatchObject({ class: "agent_ingest", state: "completed" });
      expect(parent.childJobIds).toEqual([parseChild.id, ocrChild.id]);
      expect(parseChild).toMatchObject({ state: "completed_with_warnings", parentJobId: parent.id });
      expect(ocrChild).toMatchObject({ state: "completed", parentJobId: parent.id });
      expect(ocrChild.childJobIds).toBeUndefined();
      expect(renderer.requestedPageSets).toEqual([[1]]);
      expect(adapter.callCount).toBe(1);
      expect(source.metadata).toMatchObject({
        parserStatus: "parsed_needs_ocr",
        textCoverage: "none",
        ocrStatus: "completed",
        needsOcr: false,
        agentTextReady: true
      });
      expect(source.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(true);
      expect(note).toContain("# Agent-selected OCR knowledge");
      expect(note).toContain(`[source:${captured.sourceId}#p1-ocr1]`);
      expect(operations.filter((operation) => operation.kind === "create_artifact").map((operation) => operation.jobId))
        .toEqual(expect.arrayContaining([parseChild.id, ocrChild.id]));
      expect(operations.find((operation) => operation.kind === "create_page")?.jobId).toBe(parent.id);
      expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });

  it("OCRs only parser-selected sparse PDF pages after Pi selects the OCR tool", async () => {
    const fixture = makeVault();
    const nativeText = "Native page evidence remains separate while the Agent decides whether the sparse page needs OCR.";
    const captured = await preservePdf(
      fixture,
      "agent-sparse.pdf",
      createTestPdf([nativeText, ""], "Agent Sparse")
    );
    const renderer = new StaticPdfPageRenderer();
    const adapter = new StaticNativeOcrAdapter(nativeOcrResult("OCR recovered only the parser-selected second page."));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: completeOcrTrace(
        "sparse",
        groundedOutput("Combined native and OCR evidence", ["ev_01", "ev_02"])
      )
    }));
    const jobs = makeJobs(fixture, runtime, makePdfParser(), new OcrService(adapter, undefined, renderer));

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 1, failed: 0 });

    const source = readSource(fixture.vaultPath, captured.sourceId);
    const note = fs.readFileSync(
      requireValue(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]),
      "utf8"
    );
    expect(renderer.requestedPageSets).toEqual([[2]]);
    expect(adapter.callCount).toBe(1);
    expect(source.metadata).toMatchObject({ textCoverage: "medium", ocrProcessedPages: [2], needsOcr: false });
    expect(source.artifacts.filter((artifact) => artifact.kind === "extracted_text")).toHaveLength(1);
    expect(source.artifacts.filter((artifact) => artifact.kind === "ocr")).toHaveLength(1);
    expect(note).toContain(`[source:${captured.sourceId}#p1]`);
    expect(note).toContain(`[source:${captured.sourceId}#p2-ocr1]`);
  });

  it("keeps a completed OCR effect when the provider final is structurally empty", async () => {
    const fixture = makeVault();
    const captured = await preservePdf(fixture, "agent-ocr-retry.pdf", createJpegScanPdf(1));
    let parserCalls = 0;
    const parser = makePdfParser(() => { parserCalls += 1; });
    const renderer = new StaticPdfPageRenderer();
    const adapter = new StaticNativeOcrAdapter(nativeOcrResult("One durable OCR action survives Agent retry."));
    const runtime = new SequencedPiRuntime([
      [
        toolCall("pige_inspect_source", "retry_inspect_before"),
        toolCall("pige_parse_source", "retry_parse_first"),
        toolCall("pige_ocr_source", "retry_ocr_first"),
        { kind: "text", text: "   " }
      ],
      [
        toolCall("pige_inspect_source", "retry_inspect_again"),
        toolCall("pige_parse_source", "retry_parse_second"),
        toolCall("pige_ocr_source", "retry_ocr_second"),
        toolCall("pige_inspect_source", "retry_inspect_latest"),
        toolCall("pige_create_knowledge_note", "retry_publish", groundedOutput("Retried OCR knowledge", ["ev_01"])),
        { kind: "text", text: "I reused the OCR evidence and created the note." }
      ]
    ]);
    const jobs = makeJobs(fixture, runtime, parser, new OcrService(adapter, undefined, renderer));

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 0, failed: 1 });
    const firstOcrChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    const firstArtifactOperationIds = readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_artifact" && operation.jobId === firstOcrChild.id)
      .map((operation) => operation.id);

    const ocrChildren = readJobs(fixture.vaultPath).filter((job) => job.class === "ocr");
    const ocrChild = requireValue(ocrChildren[0]);
    const provenance = (ocrChild.inputRefs ?? []).filter((ref) => ref.role === "agent_tool_call_provenance");
    expect(ocrChildren).toHaveLength(1);
    expect(ocrChild.id).toBe(firstOcrChild.id);
    expect(parserCalls).toBe(1);
    expect(renderer.callCount).toBe(1);
    expect(adapter.callCount).toBe(1);
    expect(provenance.map((ref) => ref.checksum)).toEqual([
      hashToolCallId(parentId, "retry_ocr_first")
    ]);
    expect(readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_artifact" && operation.jobId === ocrChild.id)
      .map((operation) => operation.id)).toEqual(firstArtifactOperationIds);
    expect(readJob(fixture.vaultPath, parentId)).toMatchObject({ state: "failed_retryable" });
  });

  it("keeps a waiting OCR child without overriding Pi's final prose", async () => {
    const fixture = makeVault();
    const captured = await preservePdf(fixture, "agent-ocr-wait.pdf", createJpegScanPdf(1));
    const renderer = new StaticPdfPageRenderer();
    const adapter = new StaticNativeOcrAdapter(nativeOcrResult("Recovered OCR capability produced evidence."));
    const ocr = new ToggleableOcrPort(new OcrService(adapter, undefined, renderer));
    ocr.ready = false;
    const runtime = new SequencedPiRuntime([
      [
        toolCall("pige_inspect_source", "wait_inspect_before"),
        toolCall("pige_parse_source", "wait_parse"),
        toolCall("pige_ocr_source", "wait_ocr_first"),
        { kind: "text", text: "The OCR dependency is not available yet." }
      ],
      [
        toolCall("pige_inspect_source", "wait_inspect_again"),
        toolCall("pige_ocr_source", "wait_ocr_second"),
        toolCall("pige_inspect_source", "wait_inspect_latest"),
        toolCall("pige_create_knowledge_note", "wait_publish", groundedOutput("Recovered OCR knowledge", ["ev_01"])),
        { kind: "text", text: "I recovered OCR capability and created the note." }
      ]
    ]);
    const jobs = makeJobs(fixture, runtime, makePdfParser(), ocr);

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 1, failed: 0 });
    const waitingChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    expect(waitingChild.state).toBe("waiting_dependency");
    expect(readJob(fixture.vaultPath, parentId).state).toBe("completed");
    const children = readJobs(fixture.vaultPath).filter((job) => job.class === "ocr");
    const child = requireValue(children[0]);
    expect(children).toHaveLength(1);
    expect(child.id).toBe(waitingChild.id);
    expect(child.state).toBe("waiting_dependency");
    expect(renderer.callCount).toBe(0);
    expect(adapter.callCount).toBe(0);
    expect((child.inputRefs ?? []).filter((ref) => ref.role === "agent_tool_call_provenance").map((ref) => ref.checksum))
      .toEqual([
        hashToolCallId(parentId, "wait_ocr_first")
      ]);
  });

  it("propagates parent cancellation into the active PDF OCR child without publishing", async () => {
    const fixture = makeVault();
    const captured = await preservePdf(fixture, "agent-ocr-cancel.pdf", createJpegScanPdf(1));
    const renderer = new StaticPdfPageRenderer();
    const adapter = new BlockingNativeOcrAdapter();
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "cancel_inspect"),
        toolCall("pige_parse_source", "cancel_parse"),
        toolCall("pige_ocr_source", "cancel_ocr")
      ]
    }));
    const jobs = makeJobs(fixture, runtime, makePdfParser(), new OcrService(adapter, undefined, renderer));

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    const processing = jobs.processQueuedAgentIngest({ jobIds: [parentId] });
    await adapter.started.promise;

    const childId = requireValue(jobs.list({ classes: ["ocr"], states: ["running"] }).jobs[0]).id;
    expect(jobs.cancel({ jobId: parentId })).toMatchObject({
      status: "cancel_requested",
      job: { state: "cancel_requested" }
    });
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1 });

    const parent = readJob(fixture.vaultPath, parentId);
    const child = readJob(fixture.vaultPath, childId);
    expect(parent).toMatchObject({
      state: "failed_retryable",
      cancellation: { requestedBy: "user", durableWritesApplied: true }
    });
    expect(child).toMatchObject({
      state: "failed_retryable",
      parentJobId: parent.id,
      cancellation: { requestedBy: "system", durableWritesApplied: true }
    });
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(readOperations(fixture.vaultPath).map((operation) => operation.kind)).not.toContain("create_page");
    expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
  });

  it("does not publish when selected OCR completes without readable evidence", async () => {
    const fixture = makeVault();
    const captured = await preservePdf(fixture, "agent-ocr-empty.pdf", createJpegScanPdf(1));
    const renderer = new StaticPdfPageRenderer();
    const adapter = new StaticNativeOcrAdapter(nativeOcrResult(""));
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "empty_inspect"),
        toolCall("pige_parse_source", "empty_parse"),
        toolCall("pige_ocr_source", "empty_ocr"),
        toolCall("pige_create_knowledge_note", "empty_publish", groundedOutput("Must not publish", ["ev_01"])),
        { kind: "text", text: "The OCR tool completed without readable evidence." }
      ]
    }));
    const jobs = makeJobs(fixture, runtime, makePdfParser(), new OcrService(adapter, undefined, renderer));

    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 1, failed: 0 });

    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    const source = readSource(fixture.vaultPath, captured.sourceId);
    expect(child.state).toBe("completed_with_warnings");
    expect(readJob(fixture.vaultPath, parentId).state).toBe("completed");
    expect(source.metadata).toMatchObject({ ocrStatus: "completed_empty", agentTextReady: false });
    expect(runtime.results[0]?.invokedTools).toEqual([
      "pige_inspect_source",
      "pige_parse_source",
      "pige_ocr_source",
      "pige_create_knowledge_note"
    ]);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(readOperations(fixture.vaultPath).map((operation) => operation.kind)).not.toContain("create_page");
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

class SequencedPiRuntime implements AgentIngestRuntimePort {
  #nextRun = 0;

  constructor(private readonly responses: readonly (readonly PiFauxResponse[])[]) {}

  run(request: PiAgentRunRequest): Promise<PiAgentRunResult> {
    const fauxResponses = requireValue(this.responses[this.#nextRun]);
    this.#nextRun += 1;
    return new PiAgentRuntimeAdapter({ fauxResponses }).run(request);
  }
}

class StaticPdfPageRenderer implements PdfPageRendererPort {
  callCount = 0;
  readonly requestedPageSets: number[][] = [];

  isAvailable(): boolean {
    return true;
  }

  async renderPages(_filePath: string, pageCandidates: readonly number[]): Promise<PdfPageRendererResult> {
    this.callCount += 1;
    const requestedPages = [...pageCandidates];
    this.requestedPageSets.push(requestedPages);
    const pages = requestedPages.map((page) => {
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
      renderedPages: requestedPages,
      pages,
      totalPngByteSize: pages.reduce((total, page) => total + page.pngByteSize, 0),
      warnings: [],
      truncated: false
    };
  }
}

class StaticNativeOcrAdapter implements NativeImageOcrAdapterPort {
  callCount = 0;

  constructor(readonly result: NativeOcrResult, public available = true) {}

  isAvailable(): boolean {
    return this.available;
  }

  async recognize(): Promise<NativeOcrResult> {
    this.callCount += 1;
    return this.result;
  }
}

class BlockingNativeOcrAdapter implements NativeImageOcrAdapterPort {
  readonly started = deferred<void>();

  isAvailable(): boolean {
    return true;
  }

  recognize(
    _inputPath: string,
    _preferredLanguages: readonly string[],
    signal?: AbortSignal
  ): Promise<NativeOcrResult> {
    this.started.resolve();
    return new Promise((_resolve, reject) => {
      const cancel = (): void => reject(new JobCancellationError());
      if (signal?.aborted) cancel();
      else signal?.addEventListener("abort", cancel, { once: true });
    });
  }
}

class ToggleableOcrPort implements OcrPort {
  ready = true;

  constructor(private readonly delegate: OcrPort) {}

  canOcr(sourceKind: SourceRecord["kind"]): boolean {
    return this.delegate.canOcr(sourceKind);
  }

  inspectSource(sourceRecord: SourceRecord) {
    return this.ready
      ? this.delegate.inspectSource?.(sourceRecord) ?? { ready: false, message: "OCR target unavailable." }
      : { ready: false, message: "OCR helper health is temporarily unavailable." };
  }

  ocrSource(...args: Parameters<OcrPort["ocrSource"]>): ReturnType<OcrPort["ocrSource"]> {
    return this.delegate.ocrSource(...args);
  }
}

function makeJobs(
  fixture: ReturnType<typeof makeVault>,
  runtime: AgentIngestRuntimePort,
  parser: PdfParserService,
  ocr: OcrPort
): JobsService {
  return new JobsService(
    fixture.vaultPort,
    new AgentIngestService(modelPort, runtime, capabilityPort()),
    undefined,
    parser,
    ocr
  );
}

function makePdfParser(onExtract?: () => void): PdfParserService {
  return new PdfParserService({
    isAvailable: () => true,
    extract: (filePath) => {
      onExtract?.();
      return extractPdfText({
        requestId: "agent-led-pdf-ocr",
        filePath,
        limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
      });
    }
  });
}

function capabilityPort(): AgentIngestCapabilityPort {
  return {
    snapshot: () => ({
      localDatabaseStatus: "not_initialized",
      parserToolchainReady: true,
      ocrEngines: ["apple_vision"],
      speechInputAvailable: false,
      embeddingModelInstalled: false,
      lexicalSearchAvailable: false,
      vectorSearchAvailable: false,
      rerankerAvailable: false
    })
  };
}

function completeOcrTrace(
  prefix: string,
  output: ReturnType<typeof groundedOutput>,
  repeatOcrAfterPublish = false
): readonly PiFauxResponse[] {
  return [
    toolCall("pige_inspect_source", `${prefix}_inspect_before`),
    toolCall("pige_parse_source", `${prefix}_parse`),
    toolCall("pige_ocr_source", `${prefix}_ocr`),
    toolCall("pige_inspect_source", `${prefix}_inspect_after`),
    toolCall("pige_create_knowledge_note", `${prefix}_publish`, output),
    ...(repeatOcrAfterPublish ? [toolCall("pige_ocr_source", `${prefix}_ocr_after_publish`)] : []),
    { kind: "text", text: "I recognized the preserved PDF and created the knowledge note." }
  ];
}

function toolCall(
  toolName: string,
  toolCallId: string,
  args: Readonly<Record<string, unknown>> = {}
): PiFauxResponse {
  return { kind: "tool_call", toolName, args, toolCallId };
}

function groundedOutput(title: string, evidenceRefs: readonly string[]) {
  return {
    title,
    summary: {
      text: "The preserved PDF evidence was recovered only through Agent-selected local tools.",
      evidenceRefs
    },
    keyPoints: [{
      text: "Pige retained source, parser, OCR, and publication provenance.",
      evidenceRefs
    }],
    tags: ["pdf", "ocr"],
    topics: ["Agent-led OCR"],
    entities: [],
    warnings: [],
    confidence: "high" as const
  };
}

function nativeOcrResult(text: string): NativeOcrResult {
  const hasText = text.length > 0;
  return {
    engine: "macos_vision_document",
    engineVersion: "synthetic-1",
    adapterVersion: "1.0.0",
    text,
    blocks: hasText ? [{
      text,
      kind: "line",
      confidence: 0.93,
      boundingBox: { x: 0.1, y: 0.2, width: 0.8, height: 0.1 },
      languageHints: ["en"],
      isTitle: false
    }] : [],
    languageHints: hasText ? ["en"] : [],
    ...(hasText ? { confidence: 0.93 } : {}),
    warnings: [],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 1,
      sourceHeight: 1,
      decodedWidth: 1,
      decodedHeight: 1,
      downsampled: false
    }
  };
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-pdf-ocr-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentPdfOcr",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-11T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "AgentPdfOcr");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

async function preservePdf(
  fixture: ReturnType<typeof makeVault>,
  fileName: string,
  bytes: Buffer
): Promise<{
  readonly sourceId: string;
  readonly captureJobId: string;
  readonly managedPath: string;
  readonly bytes: Buffer;
}> {
  const inputPath = path.join(path.dirname(fixture.vaultPath), fileName);
  fs.writeFileSync(inputPath, bytes);
  const result = await new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath).submitFiles({
    filePaths: [inputPath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(result.sourceIds[0]);
  markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, sourceId);
  const source = readSource(fixture.vaultPath, sourceId);
  return {
    sourceId,
    captureJobId: requireValue(result.jobIds[0]),
    managedPath: path.join(fixture.vaultPath, requireValue(source.managedCopy?.path)),
    bytes
  };
}

function hashToolCallId(parentJobId: string, toolCallId: string): string {
  return `sha256:${createHash("sha256")
    .update("pige:pi-tool-call-provenance:v1\0", "utf8")
    .update(parentJobId, "utf8")
    .update("\0", "utf8")
    .update(toolCallId, "utf8")
    .digest("hex")}`;
}

function installNetworkTripwire(): { readonly calls: number; restore(): void } {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected network access in Agent-led PDF OCR test.");
  };
  return {
    get calls() { return calls; },
    restore: () => { globalThis.fetch = originalFetch; }
  };
}

function readSource(vaultPath: string, sourceId: string): SourceRecord {
  return readJsonBySuffix<SourceRecord>(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`);
}

function readJob(vaultPath: string, jobId: string): JobRecord {
  return readJsonBySuffix<JobRecord>(path.join(vaultPath, ".pige", "jobs"), `${jobId}.json`);
}

function readJobs(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function readOperations(vaultPath: string): OperationRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "operations"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function readJsonBySuffix<T>(root: string, suffix: string): T {
  const filePath = requireValue(listFiles(root, suffix)[0]);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  });
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value?: T | PromiseLike<T>) => void;
} {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value to exist.");
  return value;
}
