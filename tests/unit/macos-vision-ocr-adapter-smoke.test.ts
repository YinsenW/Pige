import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { DocumentParserService } from "../../apps/desktop/src/main/services/document-parser-service";
import {
  HomeAgentService,
  type HomeAgentModelPort,
  type HomeAgentRetrievalPort
} from "../../apps/desktop/src/main/services/home-agent-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { MacOSVisionOcrAdapter } from "../../apps/desktop/src/main/services/macos-vision-ocr-adapter";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { OCR_HELPER_TIMEOUT_MS } from "../../apps/desktop/src/main/services/ocr-types";
import { materializeOfficeMedia } from "../../apps/desktop/src/main/services/office-media-materializer-core";
import type { OfficeMediaMaterializerPort } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { OcrService } from "../../apps/desktop/src/main/services/ocr-service";
import { extractOfficeText } from "../../apps/desktop/src/main/services/office-parser-core";
import { OfficeParserService } from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
  OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  type OfficeMediaTarget
} from "../../apps/desktop/src/main/services/office-parser-types";
import { PiAgentRuntimeAdapter } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { createTestPptx } from "./helpers/office-fixture";

const helperPath = path.join(
  process.cwd(),
  "artifacts/native/macos",
  process.arch,
  "pige-vision-ocr"
);
const hasBuiltHelper = process.platform === "darwin" && fs.existsSync(helperPath);
const MACOS_VISION_OCR_SMOKE_TIMEOUT_MS = OCR_HELPER_TIMEOUT_MS;

assert(
  Number.isFinite(MACOS_VISION_OCR_SMOKE_TIMEOUT_MS) && MACOS_VISION_OCR_SMOKE_TIMEOUT_MS > 0,
  "macOS Vision OCR smoke timeout must remain finite and positive."
);

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_pptx_vision_smoke",
    displayName: "PPTX Vision Smoke Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_pptx_vision_smoke",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_pptx_vision_smoke",
    providerProfileId: "provider_pptx_vision_smoke",
    modelId: "pptx-vision-smoke-model",
    displayName: "PPTX Vision Smoke Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-pptx-vision-smoke-key"
};

const modelPort: AgentIngestModelConfigPort & HomeAgentModelPort = {
  summary: () => ({
    presets: [],
    providers: [runtimeConfig.provider],
    models: [{ ...runtimeConfig.model, isDefault: true }],
    defaultModelProfileId: runtimeConfig.model.id,
    hasDefaultModel: true,
    defaultBinding: {
      state: "ready",
      providerProfileId: runtimeConfig.provider.id,
      modelProfileId: runtimeConfig.model.id
    }
  }),
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

describe.runIf(hasBuiltHelper)("macOS Vision OCR production adapter smoke", () => {
  it("locates the verified helper and recognizes generated text through the production adapter", {
    timeout: MACOS_VISION_OCR_SMOKE_TIMEOUT_MS
  }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-adapter-smoke-"));
    try {
      const imagePath = path.join(root, "adapter-smoke.png");
      const canvas = createCanvas(1600, 500);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111111";
      context.font = "bold 128px Helvetica";
      context.fillText("PIGE ADAPTER OCR", 80, 300);
      fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));

      const adapter = new MacOSVisionOcrAdapter();
      expect(adapter.isAvailable()).toBe(true);
      const probe = await adapter.probe();
      expect(probe).toMatchObject({
        available: true,
        helperVersion: "1.0.0",
        protocolVersion: 1,
        platform: "macos"
      });

      const result = await adapter.recognize(imagePath, ["en"]);
      const normalized = result.text.replace(/\s+/gu, " ").toLocaleUpperCase();
      expect(normalized).toContain("PIGE");
      expect(normalized).toContain("OCR");
      expect(result.blocks.length).toBeGreaterThan(0);
      expect(result.image.frameCount).toBe(1);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("recognizes a preserved image through the Agent-selected production OCR tool", {
    timeout: MACOS_VISION_OCR_SMOKE_TIMEOUT_MS
  }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-image-agent-vision-smoke-"));
    try {
      const canvas = createCanvas(1600, 500);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111111";
      context.font = "bold 112px Helvetica";
      context.fillText("PIGE IMAGE OCR", 90, 300);
      const imagePath = path.join(root, "image-ocr.png");
      fs.writeFileSync(imagePath, canvas.toBuffer("image/png"));
      createVaultOnDisk({
        parentDirectory: root,
        vaultName: "Vault",
        appDataPath: path.join(root, "app-data"),
        tempPath: path.join(root, "temp"),
        now: new Date("2026-07-10T08:00:00.000Z")
      });
      const vaultPath = path.join(root, "Vault");
      const vault = loadVaultSummary(vaultPath);
      const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
      const runtime = new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "vision_image_inspect_before" },
          { kind: "tool_call", toolName: "pige_ocr_source", args: {}, toolCallId: "vision_image_ocr" },
          { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "vision_image_inspect_after" },
          {
            kind: "tool_call",
            toolName: "pige_create_knowledge_note",
            toolCallId: "vision_image_publish",
            args: {
              title: "Image Vision OCR smoke",
              summary: { text: "The preserved image was recognized locally.", evidenceRefs: ["ev_01"] },
              keyPoints: [{ text: "Pi selected the bounded image OCR tool.", evidenceRefs: ["ev_01"] }],
              tags: ["ocr"],
              topics: ["Images"],
              entities: [],
              warnings: [],
              confidence: "high"
            }
          }
        ]
      });
      const capabilities = {
        snapshot: () => ({
          localDatabaseStatus: "not_initialized",
          parserToolchainReady: false,
          ocrEngines: ["apple_vision"],
          speechInputAvailable: false,
          embeddingModelInstalled: false,
          lexicalSearchAvailable: false,
          vectorSearchAvailable: false,
          rerankerAvailable: false
        })
      };
      const agentIngest = new AgentIngestService(modelPort, runtime, capabilities);
      const jobs = new JobsService(
        vaultPort,
        agentIngest,
        undefined,
        undefined,
        new OcrService(new MacOSVisionOcrAdapter())
      );
      const home = new HomeAgentService(vaultPort, modelPort, noRetrieval, jobs, runtime, capabilities);
      const prepared = home.prepareSourceTurn({
        text: "Recognize this image and save the useful result.",
        inputKind: "file_drop",
        objective: "auto",
        locale: "en"
      });
      const preserved = await new CaptureService(vaultPort).preserveFilesForAgentTurn({
        filePaths: [imagePath],
        inputKind: "file_drop",
        userIntent: "unknown",
        locale: "en"
      }, { jobId: prepared.jobId, sourceId: prepared.sourceId });
      const sourceId = preserved.sourceIds[0];
      expect(sourceId).toBeTruthy();
      expect(preserved.jobIds).toEqual([]);
      expect(jobs.list({ classes: ["ocr"] }).jobs).toEqual([]);

      const result = await home.submitPreparedSourceTurn(prepared);
      expect(result).toMatchObject({ state: "completed", jobId: prepared.jobId });
      const agentTurnJobs = jobs.list({ classes: ["agent_turn"] }).jobs;
      const ocrJobs = jobs.list({ classes: ["ocr"] }).jobs;
      expect(agentTurnJobs).toHaveLength(1);
      expect(agentTurnJobs[0]?.id).toBe(prepared.jobId);
      expect(["completed", "completed_with_warnings"]).toContain(agentTurnJobs[0]?.state);
      expect(jobs.list({ classes: ["capture", "agent_ingest"] }).jobs).toEqual([]);
      expect(ocrJobs).toHaveLength(1);
      expect(["completed", "completed_with_warnings"]).toContain(ocrJobs[0]?.state);
      const sourceRecordPath = findFile(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`);
      const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
        artifacts: Array<{ kind: string; path: string }>;
      };
      const textArtifact = sourceRecord.artifacts.find((artifact) => artifact.kind === "ocr");
      expect(textArtifact).toBeTruthy();
      const text = fs.readFileSync(path.join(vaultPath, textArtifact!.path), "utf8")
        .replace(/\s+/gu, " ")
        .toLocaleUpperCase();
      expect(text).toContain("PIGE");
      expect(text).toContain("OCR");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("recognizes parser-selected embedded PPTX media through the source-to-artifact pipeline", {
    timeout: MACOS_VISION_OCR_SMOKE_TIMEOUT_MS
  }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pptx-vision-smoke-"));
    try {
      const canvas = createCanvas(1600, 500);
      const context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#111111";
      context.font = "bold 112px Helvetica";
      context.fillText("PIGE MEDIA OCR", 90, 300);
      const pptxPath = path.join(root, "media-ocr.pptx");
      fs.writeFileSync(pptxPath, await createTestPptx(canvas.toBuffer("image/png")));
      createVaultOnDisk({
        parentDirectory: root,
        vaultName: "Vault",
        appDataPath: path.join(root, "app-data"),
        tempPath: path.join(root, "temp"),
        now: new Date("2026-07-10T08:00:00.000Z")
      });
      const vaultPath = path.join(root, "Vault");
      const vault = loadVaultSummary(vaultPath);
      const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
      const parser = new DocumentParserService([new OfficeParserService({
        isAvailable: () => true,
        extract: (filePath, sourceKind) => extractOfficeText({
          requestId: "pptx-vision-smoke",
          filePath,
          sourceKind,
          limits: parserLimits()
        })
      })]);
      const ocr = new OcrService(
        new MacOSVisionOcrAdapter(),
        undefined,
        undefined,
        undefined,
        new InlineOfficeMediaMaterializer()
      );
      const capture = new CaptureService(vaultPort);
      const runtime = new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "vision_pptx_inspect_before" },
          { kind: "tool_call", toolName: "pige_parse_source", args: {}, toolCallId: "vision_pptx_parse" },
          { kind: "tool_call", toolName: "pige_ocr_source", args: {}, toolCallId: "vision_pptx_ocr" },
          { kind: "tool_call", toolName: "pige_inspect_source", args: {}, toolCallId: "vision_pptx_inspect_after" },
          {
            kind: "tool_call",
            toolName: "pige_create_knowledge_note",
            toolCallId: "vision_pptx_publish",
            args: {
              title: "PPTX Vision OCR smoke",
              summary: { text: "The embedded presentation media was recognized locally.", evidenceRefs: ["ev_01"] },
              keyPoints: [{ text: "Pige preserved the presentation before OCR.", evidenceRefs: ["ev_01"] }],
              tags: ["ocr"],
              topics: ["PPTX"],
              entities: [],
              warnings: [],
              confidence: "high"
            }
          }
        ]
      });
      const capabilities = {
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
      const agentIngest = new AgentIngestService(modelPort, runtime, capabilities);
      const jobs = new JobsService(vaultPort, agentIngest, undefined, parser, ocr);
      const home = new HomeAgentService(vaultPort, modelPort, noRetrieval, jobs, runtime, capabilities);
      const prepared = home.prepareSourceTurn({
        text: "Recognize the embedded presentation media and save the result.",
        inputKind: "file_drop",
        objective: "auto",
        locale: "en"
      });
      const preserved = await capture.preserveFilesForAgentTurn({
        filePaths: [pptxPath],
        inputKind: "file_drop",
        userIntent: "unknown",
        locale: "en"
      }, { jobId: prepared.jobId, sourceId: prepared.sourceId });
      const sourceId = preserved.sourceIds[0];
      expect(sourceId).toBeTruthy();
      expect(preserved.jobIds).toEqual([]);
      const result = await home.submitPreparedSourceTurn(prepared);
      const sourceRecordPath = findFile(path.join(vaultPath, ".pige", "source-records"), `${sourceId}.json`);
      const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
        artifacts: Array<{ id: string; kind: string; path: string }>;
      };
      const textArtifact = sourceRecord.artifacts.find((artifact) => artifact.id.endsWith("_pptx_media_ocr_text"));
      expect(textArtifact).toBeTruthy();
      const text = fs.readFileSync(path.join(vaultPath, textArtifact!.path), "utf8").replace(/\s+/gu, " ").toLocaleUpperCase();

      expect(result).toMatchObject({ state: "completed", jobId: prepared.jobId });
      const agentTurnJobs = jobs.list({ classes: ["agent_turn"] }).jobs;
      expect(agentTurnJobs).toHaveLength(1);
      expect(agentTurnJobs[0]?.id).toBe(prepared.jobId);
      expect(["completed", "completed_with_warnings"]).toContain(agentTurnJobs[0]?.state);
      expect(jobs.list({ classes: ["capture", "agent_ingest"] }).jobs).toEqual([]);
      expect(text).toContain("PIGE");
      expect(text).toContain("OCR");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

const noRetrieval: HomeAgentRetrievalPort = {
  search: () => {
    throw new Error("Source-backed Vision smoke must not use Home retrieval.");
  },
  readExactSelectedEvidence: () => {
    throw new Error("Source-backed Vision smoke must not bind vault evidence.");
  },
  ask: () => {
    throw new Error("Source-backed Vision smoke must not use legacy retrieval ask.");
  }
};

class InlineOfficeMediaMaterializer implements OfficeMediaMaterializerPort {
  isAvailable(): boolean {
    return true;
  }

  materialize(filePath: string, targets: readonly OfficeMediaTarget[]) {
    return materializeOfficeMedia({
      operation: "materialize_pptx_media",
      requestId: "pptx-vision-smoke-materializer",
      filePath,
      sourceKind: "pptx_file",
      targets,
      limits: {
        maxBytes: OFFICE_PARSER_MAX_BYTES,
        maxEntries: OFFICE_PARSER_MAX_ENTRIES,
        maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
        maxTargets: OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
        maxBytesPerItem: OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
        maxTotalBytes: OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES
      }
    });
  }
}

function parserLimits() {
  return {
    maxBytes: OFFICE_PARSER_MAX_BYTES,
    maxEntries: OFFICE_PARSER_MAX_ENTRIES,
    maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
    maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
    maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
    maxSlides: OFFICE_PARSER_MAX_SLIDES,
    maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS
  };
}

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileOrUndefined(child, suffix);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return child;
    }
  }
  throw new Error(`Missing fixture file ending in ${suffix}`);
}

function findFileOrUndefined(root: string, suffix: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const nested = findFileOrUndefined(child, suffix);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      return child;
    }
  }
  return undefined;
}
