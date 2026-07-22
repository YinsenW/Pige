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
import { DocumentParserService } from "../../apps/desktop/src/main/services/document-parser-service";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  OcrService,
  type NativeImageOcrAdapterPort
} from "../../apps/desktop/src/main/services/ocr-service";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import type { OfficeMediaMaterializerPort } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { extractOfficeText } from "../../apps/desktop/src/main/services/office-parser-core";
import {
  OfficeParserService,
  type OfficeTextExtractor
} from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_MEDIA_MATERIALIZER_ID,
  OFFICE_MEDIA_MATERIALIZER_VERSION,
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  OFFICE_PARSER_VERSION,
  type OfficeExtractionResult,
  type OfficeMediaTarget
} from "../../apps/desktop/src/main/services/office-parser-types";
import {
  PiAgentRuntimeAdapter,
  type PiAgentRunRequest,
  type PiAgentRunResult,
  type PiFauxResponse
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { markSourceAsLegacyAgentIngestFixture } from "../helpers/legacy-agent-ingest-fixture";
import { createTestDocx, createTestPptx, TINY_PNG } from "./helpers/office-fixture";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_office_tool",
    displayName: "Office Tool Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_office_tool",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_office_tool",
    providerProfileId: "provider_office_tool",
    modelId: "office-tool-model",
    displayName: "Office Tool Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-office-tool-key"
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

describe("Agent-led Office parse tool", { timeout: 15_000 }, () => {
  it.each([
    { kind: "docx_file" as const, fileName: "agent-knowledge.docx", bytes: createTestDocx, expected: "Local knowledge architecture" },
    { kind: "pptx_file" as const, fileName: "agent-roadmap.pptx", bytes: createTestPptx, expected: "Roadmap first" }
  ])("runs Pi inspect -> parse -> inspect -> publish for $kind", async ({ kind, fileName, bytes, expected }) => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, fileName, await bytes());
    let parserCalls = 0;
    const parser = makeOfficeParser(() => { parserCalls += 1; });
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: completeParseTrace(kind, groundedOutput(`Agent-selected ${kind === "docx_file" ? "DOCX" : "PPTX"} knowledge`))
    }));
    const jobs = makeJobs(fixture, runtime, parser, true);
    const network = installNetworkTripwire();

    try {
      expect(jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });
      const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
      expect(readJobs(fixture.vaultPath).filter((job) => job.class === "parse")).toEqual([]);
      expect(parserCalls).toBe(0);

      expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });

      const parent = readJob(fixture.vaultPath, parentId);
      const parseChildren = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
      const child = requireValue(parseChildren[0]);
      const source = readSource(fixture.vaultPath, captured.sourceId);
      const textArtifact = requireValue(source.artifacts.find((artifact) => artifact.kind === "extracted_text"));
      const notePath = requireValue(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]);
      const operations = readOperations(fixture.vaultPath);

      expect(runtime.results[0]?.invokedTools).toEqual([
        "pige_inspect_source",
        "pige_parse_source",
        "pige_inspect_source",
        "pige_create_knowledge_note"
      ]);
      expect(parserCalls).toBe(1);
      expect(parent).toMatchObject({ class: "agent_ingest", state: "completed_with_warnings", childJobIds: [child.id] });
      expect(child).toMatchObject({
        class: "parse",
        state: "completed_with_warnings",
        parentJobId: parent.id,
        sourceId: captured.sourceId
      });
      expect(readJobs(fixture.vaultPath).filter((job) => job.class === "ocr")).toEqual([]);
      expect(source.metadata).toMatchObject({
        parserStatus: "parsed_needs_ocr",
        parserId: OFFICE_PARSER_ID,
        parserVersion: OFFICE_PARSER_VERSION,
        agentTextReady: true,
        needsOcr: true
      });
      expect(fs.readFileSync(path.join(fixture.vaultPath, textArtifact.path), "utf8")).toContain(expected);
      expect(fs.readFileSync(notePath, "utf8")).toContain(expected.includes("Roadmap") ? "PPTX" : "DOCX");
      expect(operations.find((operation) => operation.kind === "create_artifact")?.jobId).toBe(child.id);
      expect(operations.find((operation) => operation.kind === "create_page")?.jobId).toBe(parent.id);
      expect(fs.readFileSync(captured.managedPath)).toEqual(captured.bytes);
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });

  it.each([
    { kind: "docx_file" as const, fileName: "waiting.docx", bytes: createTestDocx },
    { kind: "pptx_file" as const, fileName: "waiting.pptx", bytes: createTestPptx }
  ])("keeps a waiting $kind parse child without overriding Pi's final prose", async ({ kind, fileName, bytes }) => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, fileName, await bytes());
    const firstRuntime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", `${kind}_wait_inspect`),
        toolCall("pige_parse_source", `${kind}_wait_parse`),
        { kind: "text", text: "The parser dependency is not available yet." }
      ]
    }));
    const waitingJobs = makeJobs(fixture, firstRuntime, undefined, true);
    waitingJobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(waitingJobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await waitingJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const firstChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
    expect(firstChild).toMatchObject({ state: "waiting_dependency", parentJobId: parentId });
    expect(readJob(fixture.vaultPath, parentId).state).toBe("completed");
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(readOperations(fixture.vaultPath).some((operation) => operation.kind === "create_page")).toBe(false);
  });

  it("keeps parsed PPTX evidence without inventing an OCR action when OCR is unavailable", async () => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, "image-only.pptx", await createTestPptx());
    let parserCalls = 0;
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "pptx_empty_inspect"),
        toolCall("pige_parse_source", "pptx_empty_parse"),
        { kind: "text", text: "The presentation needs OCR before it can be processed." }
      ]
    }));
    const parser = new DocumentParserService([
      new OfficeParserService({
        extract: async () => {
          parserCalls += 1;
          return emptyPptxExtraction();
        }
      })
    ]);
    const jobs = makeJobs(fixture, runtime, parser, true);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });

    const parent = readJob(fixture.vaultPath, parentId);
    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
    const source = readSource(fixture.vaultPath, captured.sourceId);
    expect(parent).toMatchObject({ state: "completed", childJobIds: [child.id] });
    expect(child).toMatchObject({ state: "completed_with_warnings", parentJobId: parent.id });
    expect(source.metadata).toMatchObject({ agentTextReady: false, needsOcr: true, textCoverage: "none" });
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "ocr")).toEqual([]);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(readOperations(fixture.vaultPath).some((operation) => operation.kind === "create_page")).toBe(false);
    expect(parserCalls).toBe(1);
  });

  it("runs Pi inspect -> parse -> OCR -> inspect -> publish for a media-only PPTX", async () => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, "media-only.pptx", await createTestPptx());
    const adapter = new StaticNativeOcrAdapter(
      validNativeOcrResult("Agent-selected PPTX OCR recovered slide evidence.")
    );
    const parser = new DocumentParserService([
      new OfficeParserService({ extract: async () => emptyPptxExtraction() })
    ]);
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "pptx_ocr_inspect_before"),
        toolCall("pige_parse_source", "pptx_ocr_parse"),
        toolCall("pige_ocr_source", "pptx_ocr_recognize"),
        toolCall("pige_inspect_source", "pptx_ocr_inspect_after"),
        toolCall(
          "pige_create_knowledge_note",
          "pptx_ocr_publish",
          groundedOutput("Agent-selected PPTX OCR knowledge")
        ),
        { kind: "text", text: "I recognized the presentation media and created the note." }
      ]
    }));
    const ocr = new OcrService(
      adapter,
      undefined,
      undefined,
      undefined,
      new StaticOfficeMediaMaterializer()
    );
    const jobs = makeJobs(fixture, runtime, parser, true, ocr);
    const network = installNetworkTripwire();

    try {
      jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
      const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
      const result = await jobs.processQueuedAgentIngest({ jobIds: [parentId] });
      expect(result).toEqual({
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

      expect(runtime.results[0]?.invokedTools).toEqual([
        "pige_inspect_source",
        "pige_parse_source",
        "pige_ocr_source",
        "pige_inspect_source",
        "pige_create_knowledge_note"
      ]);
      expect(parent.childJobIds).toEqual([parseChild.id, ocrChild.id]);
      expect(parseChild).toMatchObject({ state: "completed_with_warnings", parentJobId: parent.id });
      expect(ocrChild).toMatchObject({ state: "completed", parentJobId: parent.id });
      expect(adapter.callCount).toBe(1);
      expect(source.metadata).toMatchObject({
        ocrProcessedMediaCount: 1,
        ocrStatus: "completed",
        needsOcr: false,
        agentTextReady: true
      });
      expect(source.artifacts.some((artifact) => artifact.id.endsWith("_pptx_media_ocr_text"))).toBe(true);
      expect(note).toContain("# Agent-selected PPTX OCR knowledge");
      expect(note).toContain(`[source:${captured.sourceId}#slide1-media1-ocr1]`);
      expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_artifact")
        .map((operation) => operation.jobId)).toEqual(expect.arrayContaining([parseChild.id, ocrChild.id]));
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });

  it("keeps a waiting PPTX OCR child without overriding Pi's final prose", async () => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, "waiting-media.pptx", await createTestPptx());
    const parser = new DocumentParserService([
      new OfficeParserService({ extract: async () => emptyPptxExtraction() })
    ]);
    const unavailableAdapter = new StaticNativeOcrAdapter(
      validNativeOcrResult("This unavailable adapter must not run."),
      false
    );
    const waitingRuntime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "pptx_waiting_ocr_inspect"),
        toolCall("pige_parse_source", "pptx_waiting_ocr_parse"),
        toolCall("pige_ocr_source", "pptx_waiting_ocr_call"),
        { kind: "text", text: "The OCR dependency is not available yet." }
      ]
    }));
    const waitingJobs = makeJobs(
      fixture,
      waitingRuntime,
      parser,
      true,
      new OcrService(unavailableAdapter, undefined, undefined, undefined, new StaticOfficeMediaMaterializer())
    );
    waitingJobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(waitingJobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await waitingJobs.processQueuedAgentIngest({ jobIds: [parentId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const firstOcrChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    expect(firstOcrChild).toMatchObject({ state: "waiting_dependency", parentJobId: parentId });
    expect(readJob(fixture.vaultPath, parentId).state).toBe("completed");
    expect(unavailableAdapter.callCount).toBe(0);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
  });

  it("keeps completed PPTX parse and OCR effects when the provider final is structurally empty", async () => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, "retry-media.pptx", await createTestPptx());
    let parserCalls = 0;
    const parser = new DocumentParserService([
      new OfficeParserService({
        extract: async () => {
          parserCalls += 1;
          return emptyPptxExtraction();
        }
      })
    ]);
    const adapter = new StaticNativeOcrAdapter(validNativeOcrResult("One PPTX OCR action survives Agent retry."));
    const runtime = new SequencedRuntime([
      [
        toolCall("pige_inspect_source", "pptx_retry_inspect_first"),
        toolCall("pige_parse_source", "pptx_retry_parse_first"),
        toolCall("pige_ocr_source", "pptx_retry_ocr_first"),
        { kind: "text", text: "   " }
      ],
      [
        toolCall("pige_inspect_source", "pptx_retry_inspect_second"),
        toolCall("pige_parse_source", "pptx_retry_parse_second"),
        toolCall("pige_ocr_source", "pptx_retry_ocr_second"),
        toolCall("pige_inspect_source", "pptx_retry_inspect_latest"),
        toolCall("pige_create_knowledge_note", "pptx_retry_publish", groundedOutput("Retried PPTX OCR knowledge")),
        { kind: "text", text: "I reused the OCR result and created the note." }
      ]
    ]);
    const jobs = makeJobs(
      fixture,
      runtime,
      parser,
      true,
      new OcrService(adapter, undefined, undefined, undefined, new StaticOfficeMediaMaterializer())
    );
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;

    expect(await jobs.processQueuedAgentIngest({ jobIds: [parentId] })).toMatchObject({ completed: 0, failed: 1 });
    const firstParseChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
    const firstOcrChild = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "ocr"));
    const firstArtifactOperations = readOperations(fixture.vaultPath)
      .filter((operation) => operation.kind === "create_artifact")
      .map((operation) => operation.id)
      .sort();

    const parseChildren = readJobs(fixture.vaultPath).filter((job) => job.class === "parse");
    const ocrChildren = readJobs(fixture.vaultPath).filter((job) => job.class === "ocr");
    expect(parseChildren).toHaveLength(1);
    expect(ocrChildren).toHaveLength(1);
    expect(parseChildren[0]?.id).toBe(firstParseChild.id);
    expect(ocrChildren[0]?.id).toBe(firstOcrChild.id);
    expect(parserCalls).toBe(1);
    expect(adapter.callCount).toBe(1);
    expect(readOperations(fixture.vaultPath).filter((operation) => operation.kind === "create_artifact")
      .map((operation) => operation.id).sort()).toEqual(firstArtifactOperations);
    expect(readJob(fixture.vaultPath, parentId)).toMatchObject({
      state: "failed_retryable",
      childJobIds: [firstParseChild.id, firstOcrChild.id]
    });
  });

  it("propagates parent cancellation into the active Office parser child", async () => {
    const fixture = makeVault();
    const captured = await preserveOffice(fixture, "cancel.docx", await createTestDocx());
    const started = deferred<void>();
    const parser = new DocumentParserService([
      new OfficeParserService(new BlockingOfficeExtractor(started.resolve))
    ]);
    const runtime = new RecordingRuntime(new PiAgentRuntimeAdapter({
      fauxResponses: [
        toolCall("pige_inspect_source", "office_cancel_inspect"),
        toolCall("pige_parse_source", "office_cancel_parse")
      ]
    }));
    const jobs = makeJobs(fixture, runtime, parser, true);
    jobs.processQueuedCaptures({ jobIds: [captured.captureJobId] });
    const parentId = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]).id;
    const processing = jobs.processQueuedAgentIngest({ jobIds: [parentId] });
    await started.promise;

    expect(jobs.cancel({ jobId: parentId })).toMatchObject({ status: "cancel_requested" });
    expect(await processing).toEqual({ processed: 1, completed: 0, failed: 1 });

    const parent = readJob(fixture.vaultPath, parentId);
    const child = requireValue(readJobs(fixture.vaultPath).find((job) => job.class === "parse"));
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

class BlockingOfficeExtractor implements OfficeTextExtractor {
  constructor(private readonly onStart: () => void) {}

  isAvailable(): boolean {
    return true;
  }

  extract(_filePath: string, _sourceKind: "docx_file" | "pptx_file", signal?: AbortSignal): Promise<OfficeExtractionResult> {
    this.onStart();
    return new Promise((_resolve, reject) => {
      if (signal?.aborted) {
        reject(new JobCancellationError());
        return;
      }
      signal?.addEventListener("abort", () => reject(new JobCancellationError()), { once: true });
    });
  }
}

class StaticNativeOcrAdapter implements NativeImageOcrAdapterPort {
  callCount = 0;

  constructor(
    private readonly result: NativeOcrResult,
    private readonly available = true
  ) {}

  isAvailable(): boolean {
    return this.available;
  }

  async recognize(): Promise<NativeOcrResult> {
    this.callCount += 1;
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

function makeJobs(
  fixture: ReturnType<typeof makeVault>,
  runtime: AgentIngestRuntimePort,
  parser: DocumentParserService | undefined,
  parserReady: boolean,
  ocr?: OcrService
): JobsService {
  return new JobsService(
    fixture.vaultPort,
    new AgentIngestService(modelPort, runtime, capabilityPort(parserReady, Boolean(ocr))),
    undefined,
    parser,
    ocr
  );
}

function makeOfficeParser(onExtract?: () => void): DocumentParserService {
  return new DocumentParserService([
    new OfficeParserService({
      extract: async (filePath, sourceKind) => {
        onExtract?.();
        return extractOfficeText({
          requestId: `agent-office-${sourceKind}`,
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
        });
      }
    })
  ]);
}

function completeParseTrace(
  sourceKind: "docx_file" | "pptx_file",
  output: unknown,
  suffix = "native"
): readonly PiFauxResponse[] {
  return [
    toolCall("pige_inspect_source", `${sourceKind}_${suffix}_inspect_before`),
    toolCall("pige_parse_source", `${sourceKind}_${suffix}_parse`),
    toolCall("pige_inspect_source", `${sourceKind}_${suffix}_inspect_after`),
    toolCall("pige_create_knowledge_note", `${sourceKind}_${suffix}_publish`, output),
    { kind: "text", text: "I parsed the preserved Office source and created the knowledge note." }
  ];
}

function toolCall(toolName: string, toolCallId: string, args: unknown = {}): PiFauxResponse {
  return { kind: "tool_call", toolName, args, toolCallId };
}

function capabilityPort(parserToolchainReady: boolean, ocrReady = false): AgentIngestCapabilityPort {
  return {
    snapshot: () => ({
      localDatabaseStatus: "not_initialized",
      parserToolchainReady,
      ocrEngines: ocrReady ? ["apple_vision"] : [],
      speechInputAvailable: false,
      embeddingModelInstalled: false,
      lexicalSearchAvailable: false,
      vectorSearchAvailable: false,
      rerankerAvailable: false
    })
  };
}

function groundedOutput(title: string) {
  return {
    title,
    summary: {
      text: "The Office document was parsed only after the Agent selected the bounded local tool.",
      evidenceRefs: ["ev_01"]
    },
    keyPoints: [{
      text: "The generated note remains grounded in locator-bearing Office evidence.",
      evidenceRefs: ["ev_01"]
    }],
    tags: ["office"],
    topics: ["Agent-led parsing"],
    entities: [],
    warnings: [],
    confidence: "high"
  };
}

function emptyPptxExtraction(): OfficeExtractionResult {
  return {
    parserId: OFFICE_PARSER_ID,
    engine: OFFICE_PARSER_ENGINE,
    engineVersion: OFFICE_PARSER_VERSION,
    format: "pptx",
    title: "Image-only presentation",
    text: "",
    textCharacterCount: 0,
    textCoverage: "none",
    truncated: false,
    needsOcr: true,
    agentTextReady: false,
    ocrCandidateLocators: ["slide:1"],
    unitCount: 1,
    processedUnitCount: 1,
    unitsWithText: 0,
    units: [{
      index: 1,
      locator: "slide:1",
      kind: "slide",
      characterStart: 0,
      characterEnd: 0,
      characterCount: 0,
      imageCount: 1,
      mediaReferences: [{
        mediaIndex: 1,
        locator: "slide:1/media:1",
        packagePath: "ppt/media/image1.png",
        size: 68,
        extension: ".png"
      }],
      needsOcr: true,
      warnings: []
    }],
    entryCount: 1,
    totalUncompressedBytes: 68,
    mediaReferences: [{ packagePath: "ppt/media/image1.png", size: 68, extension: ".png" }],
    structure: { slides: 1 },
    warnings: ["pptx_text_missing"]
  };
}

function validNativeOcrResult(text: string): NativeOcrResult {
  return {
    engine: "macos_vision_document",
    engineVersion: "revision1",
    adapterVersion: "1.0.0",
    text,
    blocks: [{
      text,
      kind: "line",
      confidence: 0.95,
      boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.12 },
      languageHints: ["en"],
      isTitle: false
    }],
    languageHints: ["en"],
    confidence: 0.95,
    warnings: [],
    image: {
      typeIdentifier: "public.png",
      frameCount: 1,
      sourceWidth: 1200,
      sourceHeight: 800,
      decodedWidth: 1200,
      decodedHeight: 800,
      downsampled: false
    }
  };
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-office-tool-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentOfficeTool",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-11T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "AgentOfficeTool");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

async function preserveOffice(
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

function installNetworkTripwire(): { readonly calls: number; restore(): void } {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected network access in Agent-led Office test.");
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
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord);
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
  readonly resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value to exist.");
  return value;
}
