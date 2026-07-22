import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { DocumentParserService } from "../../apps/desktop/src/main/services/document-parser-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { OcrService, type NativeImageOcrAdapterPort } from "../../apps/desktop/src/main/services/ocr-service";
import { OfficeParserService } from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_VERSION,
  type OfficeExtractionResult
} from "../../apps/desktop/src/main/services/office-parser-types";
import { PdfParserService } from "../../apps/desktop/src/main/services/pdf-parser-service";
import { PiAgentRuntimeAdapter } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { ScriptedAgentIngestRuntime } from "../helpers/scripted-agent-ingest-runtime";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import {
  PDF_PARSER_ENGINE,
  PDF_PARSER_ID,
  PDF_PARSER_VERSION,
  type PdfExtractionResult
} from "../../apps/desktop/src/main/services/pdf-parser-types";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import {
  createVaultOnDisk,
  loadVaultSummary,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";
import type { VaultSummary } from "@pige/contracts";
import { JobRecordSchema, type SourceRecord } from "@pige/schemas";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("referenced-original source pipeline", () => {
  it("runs a referenced PDF through parser artifacts and Agent ingest without a managed copy", async () => {
    const fixture = makeFixture();
    const originalPath = path.join(path.dirname(fixture.vaultPath), "referenced.pdf");
    fs.writeFileSync(originalPath, "%PDF referenced fixture", "utf8");
    const capture = new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath);
    const captured = await capture.submitFiles({
      filePaths: [originalPath], inputKind: "file_picker", userIntent: "capture", locale: "en"
    });
    let parserInputPath: string | undefined;
    const parser = new DocumentParserService([new PdfParserService({
      extract: async (filePath) => {
        parserInputPath = filePath;
        expect(fs.readFileSync(filePath, "utf8")).toBe("%PDF referenced fixture");
        return pdfExtraction;
      }
    })]);
    const runtime = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_ref_inspect_before" },
        { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: "pi_ref_parse" },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_ref_inspect_after" },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: referencedOutput,
          toolCallId: "pi_ref_publish"
        }
      ]
    });
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, parserCapabilityPort),
      undefined,
      parser
    );

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    await jobs.processQueuedAgentIngest();

    const record = readSourceRecord(fixture.vaultPath, captured.sourceIds[0] ?? "");
    expect(record.storageStrategy).toBe("reference_original");
    expect(record.managedCopy).toBeUndefined();
    expect(record.artifacts.some((artifact) => artifact.kind === "extracted_text")).toBe(true);
    expect(findFiles(path.join(fixture.vaultPath, "wiki"), ".md")).toHaveLength(1);
    expect(fs.readFileSync(requireValue(findFiles(path.join(fixture.vaultPath, "wiki"), ".md")[0]), "utf8"))
      .toContain(`[source:${captured.sourceIds[0]}#p1]`);
    const capturedParserInputPath = requireValue(parserInputPath);
    expect(capturedParserInputPath).not.toBe(originalPath);
    expect(fs.existsSync(capturedParserInputPath)).toBe(false);
    expect(fs.readFileSync(originalPath, "utf8")).toBe("%PDF referenced fixture");
  });

  it("runs a referenced image through OCR artifacts and Agent ingest without a managed copy", async () => {
    const fixture = makeFixture();
    const originalPath = path.join(path.dirname(fixture.vaultPath), "referenced.png");
    fs.writeFileSync(originalPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
    const capture = new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath);
    const captured = await capture.submitFiles({
      filePaths: [originalPath], inputKind: "file_drop", userIntent: "capture", locale: "en"
    });
    const runtime = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_ref_image_inspect_before" },
        { kind: "tool_call", toolName: "pige_ocr_source", args: {}, toolCallId: "pi_ref_image_ocr" },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "pi_ref_image_inspect_after" },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: referencedOutput,
          toolCallId: "pi_ref_image_publish"
        }
      ]
    });
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(modelPort, runtime, imageOcrCapabilityPort),
      undefined,
      undefined,
      new OcrService(new StaticOcrAdapter())
    );

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    expect(jobs.list({ classes: ["ocr"] }).jobs).toEqual([]);
    await jobs.processQueuedAgentIngest();

    const record = readSourceRecord(fixture.vaultPath, captured.sourceIds[0] ?? "");
    expect(record.storageStrategy).toBe("reference_original");
    expect(record.managedCopy).toBeUndefined();
    expect(record.artifacts.some((artifact) => artifact.kind === "ocr")).toBe(true);
    expect(jobs.list({ classes: ["ocr"], states: ["completed"] }).jobs).toHaveLength(1);
    expect(findFiles(path.join(fixture.vaultPath, "wiki"), ".md")).toHaveLength(1);
    expect(fs.readFileSync(originalPath)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]));
  });

  it("runs a referenced DOCX through the Office parser and Agent ingest without a managed copy", async () => {
    const fixture = makeFixture();
    const originalPath = path.join(path.dirname(fixture.vaultPath), "referenced.docx");
    fs.writeFileSync(originalPath, Buffer.from("PK referenced DOCX fixture"));
    const captured = await new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath).submitFiles({
      filePaths: [originalPath], inputKind: "file_picker", userIntent: "capture", locale: "en"
    });
    const model = new CapturingModelClient();
    const parser = new DocumentParserService([new OfficeParserService({ extract: async () => officeExtraction })]);
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(modelPort, model), undefined, parser);

    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    const sourceId = captured.sourceIds[0] ?? "";
    const sourceRecordPath = requireValue(
      findFiles(path.join(fixture.vaultPath, ".pige", "source-records"), `${sourceId}.json`)[0]
    );
    await parser.parseSource(
      fixture.vaultPath,
      readSourceRecord(fixture.vaultPath, sourceId),
      sourceRecordPath,
      JobRecordSchema.parse({
        id: `job_20260710_${"refdocx".padEnd(12, "0")}`,
        class: "parse",
        state: "running",
        sourceId,
        createdAt: "2026-07-10T00:00:00.000Z",
        updatedAt: "2026-07-10T00:00:00.000Z",
        message: "Explicit referenced DOCX parser substrate test"
      })
    );
    await jobs.processQueuedAgentIngest();

    const record = readSourceRecord(fixture.vaultPath, sourceId);
    expect(record.storageStrategy).toBe("reference_original");
    expect(record.managedCopy).toBeUndefined();
    expect(record.artifacts.some((artifact) => artifact.kind === "extracted_text")).toBe(true);
    expect(model.lastUserPrompt).toContain("block:1");
  });

  it("keeps Agent ingest waiting when a referenced text original is disconnected", async () => {
    const fixture = makeFixture();
    const originalPath = path.join(path.dirname(fixture.vaultPath), "referenced.md");
    fs.writeFileSync(originalPath, "# Referenced knowledge", "utf8");
    const captured = await new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath).submitFiles({
      filePaths: [originalPath], inputKind: "file_drop", userIntent: "capture", locale: "en"
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(modelPort, new CapturingModelClient()));
    jobs.processQueuedCaptures({ jobIds: captured.jobIds });
    fs.rmSync(originalPath);

    await jobs.processQueuedAgentIngest();

    expect(jobs.list({ classes: ["agent_ingest"], states: ["waiting_dependency"] }).jobs[0]?.message)
      .toContain("referenced original source");
  });
});

function makeFixture(): {
  readonly vaultPath: string;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-reference-pipeline-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Vault",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-10T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Vault");
  updateVaultSourceStorageStrategy(vaultPath, "reference_original");
  return {
    vaultPath,
    vaultPort: {
      current: () => loadVaultSummary(vaultPath),
      activeVaultPath: () => vaultPath
    }
  };
}

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_local",
    displayName: "Local",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    authSecretRef: "provider_secret_local",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  },
  model: {
    id: "model_local",
    providerProfileId: "provider_local",
    modelId: "local-model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  },
  apiKey: "local-test-key"
};

const modelPort: AgentIngestModelConfigPort = {
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

const parserCapabilityPort = {
  snapshot: () => ({
    localDatabaseStatus: "not_initialized" as const,
    parserToolchainReady: true,
    ocrEngines: [],
    speechInputAvailable: false,
    embeddingModelInstalled: false,
    lexicalSearchAvailable: false,
    vectorSearchAvailable: false,
    rerankerAvailable: false
  })
};

const imageOcrCapabilityPort = {
  snapshot: () => ({
    localDatabaseStatus: "not_initialized" as const,
    parserToolchainReady: false,
    ocrEngines: ["apple_vision"],
    speechInputAvailable: false,
    embeddingModelInstalled: false,
    lexicalSearchAvailable: false,
    vectorSearchAvailable: false,
    rerankerAvailable: false
  })
};

const referencedOutput = {
  title: "Referenced knowledge",
  summary: { text: "Verified referenced evidence.", evidenceRefs: ["ev_01"] },
  keyPoints: [{ text: "Verified", evidenceRefs: ["ev_01"] }],
  tags: [],
  topics: [],
  entities: [],
  warnings: [],
  confidence: "high"
} as const;

class CapturingModelClient extends ScriptedAgentIngestRuntime {
  constructor() {
    super({
      title: "Referenced knowledge",
      summary: { text: "Verified referenced evidence.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Verified", evidenceRefs: ["ev_01"] }],
      tags: [], topics: [], entities: [], warnings: [], confidence: "high"
    });
  }

  get lastUserPrompt(): string {
    return this.userPrompt;
  }
}

class StaticOcrAdapter implements NativeImageOcrAdapterPort {
  isAvailable(): boolean { return true; }
  async recognize(): Promise<NativeOcrResult> {
    return {
      engine: "macos_vision_document",
      engineVersion: "revision1",
      adapterVersion: "1.0.0",
      text: "Referenced image knowledge",
      blocks: [{
        text: "Referenced image knowledge", kind: "line", confidence: 0.95,
        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.1 }, languageHints: ["en"], isTitle: true
      }],
      languageHints: ["en"], confidence: 0.95, warnings: [],
      image: {
        typeIdentifier: "public.png", frameCount: 1, sourceWidth: 100, sourceHeight: 100,
        decodedWidth: 100, decodedHeight: 100, downsampled: false
      }
    };
  }
}

const pdfText = "Referenced PDF knowledge";
const pdfExtraction: PdfExtractionResult = {
  parserId: PDF_PARSER_ID,
  engine: PDF_PARSER_ENGINE,
  engineVersion: PDF_PARSER_VERSION,
  pageCount: 1,
  processedPageCount: 1,
  pagesWithText: 1,
  textCharacterCount: pdfText.length,
  textCoverage: "high",
  truncated: false,
  needsOcr: false,
  agentTextReady: true,
  ocrCandidatePages: [],
  title: "Referenced PDF",
  text: pdfText,
  pages: [{ page: 1, locator: "page:1", text: pdfText, characterCount: pdfText.length, needsOcr: false, warnings: [] }],
  warnings: []
};

const officeText = "Referenced Office knowledge";
const officeExtraction: OfficeExtractionResult = {
  parserId: OFFICE_PARSER_ID,
  engine: OFFICE_PARSER_ENGINE,
  engineVersion: OFFICE_PARSER_VERSION,
  format: "docx",
  title: "Referenced DOCX",
  text: officeText,
  textCharacterCount: officeText.length,
  textCoverage: "high",
  truncated: false,
  needsOcr: false,
  agentTextReady: true,
  ocrCandidateLocators: [],
  unitCount: 1,
  processedUnitCount: 1,
  unitsWithText: 1,
  units: [{
    index: 1,
    locator: "block:1",
    kind: "paragraph",
    characterStart: 0,
    characterEnd: officeText.length,
    characterCount: officeText.length,
    imageCount: 0,
    needsOcr: false,
    warnings: []
  }],
  entryCount: 1,
  totalUncompressedBytes: officeText.length,
  mediaReferences: [],
  structure: { paragraphCount: 1 },
  warnings: []
};

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord {
  const file = findFiles(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`)[0];
  if (!file) throw new Error("Missing Source Record.");
  return JSON.parse(fs.readFileSync(file, "utf8")) as SourceRecord;
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(full, suffix) : entry.isFile() && entry.name.endsWith(suffix) ? [full] : [];
  });
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
