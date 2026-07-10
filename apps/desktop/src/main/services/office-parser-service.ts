import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type JobRecord, type SourceKind, type SourceRecord } from "@pige/schemas";
import { OFFICE_PARSER_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/office-parser-entry";
import {
  ParserArtifactService,
  type DocumentParseSourceResult
} from "./parser-artifact-service";
import { createVerifiedSourceFileSnapshotAsync } from "./source-file-access";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  OFFICE_PARSER_TIMEOUT_MS,
  OFFICE_PARSER_VERSION,
  type OfficeExtractionResult,
  type OfficeParserRequest,
  type OfficeParserWorkerResponse
} from "./office-parser-types";

type OfficeSourceKind = Extract<SourceKind, "docx_file" | "pptx_file">;

export interface OfficeTextExtractor {
  isAvailable?(): boolean;
  extract(filePath: string, sourceKind: OfficeSourceKind): Promise<OfficeExtractionResult>;
}

export class OfficeParserWorkerAdapter implements OfficeTextExtractor {
  readonly #timeoutMs: number;
  readonly #workerUrl: URL;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    workerUrl = new URL(OFFICE_PARSER_WORKER_ENTRY_RELATIVE_PATH, import.meta.url),
    timeoutMs = OFFICE_PARSER_TIMEOUT_MS,
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#workerUrl = workerUrl;
    this.#timeoutMs = timeoutMs;
    this.#resolveModule = resolveModule;
  }

  isAvailable(): boolean {
    try {
      return Boolean(
        this.#resolveModule("mammoth/package.json") &&
        this.#resolveModule("fast-xml-parser/package.json") &&
        this.#resolveModule("yauzl/package.json")
      );
    } catch {
      return false;
    }
  }

  extract(filePath: string, sourceKind: OfficeSourceKind): Promise<OfficeExtractionResult> {
    const request: OfficeParserRequest = {
      requestId: randomUUID(),
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
    };

    return new Promise((resolve, reject) => {
      const worker = new Worker(this.#workerUrl, {
        name: "pige-office-parser",
        resourceLimits: { maxOldGenerationSizeMb: 512 }
      });
      let settled = false;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        void worker.terminate();
        callback();
      };
      const timeout = setTimeout(() => {
        finish(() => reject(new PigeDomainError("parser.office.timeout", "Office text extraction exceeded the local time limit.")));
      }, this.#timeoutMs);

      worker.once("message", (message: OfficeParserWorkerResponse) => {
        if (!message || message.requestId !== request.requestId) {
          finish(() => reject(new PigeDomainError("parser.office.worker_protocol", "The Office parser worker returned an invalid response.")));
          return;
        }
        if (message.ok) {
          finish(() => resolve(message.result));
          return;
        }
        finish(() => reject(new PigeDomainError(message.error.code, message.error.message)));
      });
      worker.once("error", () => {
        finish(() => reject(new PigeDomainError("parser.office.worker_failed", "The Office parser worker failed.")));
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) {
          finish(() => reject(new PigeDomainError("parser.office.worker_failed", "The Office parser worker exited before completing.")));
        }
      });
      worker.postMessage(request);
    });
  }
}

export class OfficeParserService {
  readonly #extractor: OfficeTextExtractor;
  readonly #artifacts: ParserArtifactService;

  constructor(extractor: OfficeTextExtractor = new OfficeParserWorkerAdapter(), artifacts = new ParserArtifactService()) {
    this.#extractor = extractor;
    this.#artifacts = artifacts;
  }

  canParse(sourceKind: SourceKind): boolean {
    return (sourceKind === "docx_file" || sourceKind === "pptx_file") && this.#extractor.isAvailable?.() !== false;
  }

  async parseSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord
  ): Promise<DocumentParseSourceResult> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind !== "docx_file" && parsedSource.kind !== "pptx_file") {
      throw new PigeDomainError("parser.unsupported_source", "The Office parser cannot process this source kind.");
    }
    const format = parsedSource.kind === "docx_file" ? "docx" : "pptx";
    const parser = { id: OFFICE_PARSER_ID, engine: OFFICE_PARSER_ENGINE, version: OFFICE_PARSER_VERSION } as const;
    const existing = this.#artifacts.readExisting(vaultPath, parsedSource, sourceRecordPath, job, format, parser);
    if (existing) return existing;

    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, parsedSource);
    let extraction: OfficeExtractionResult;
    try {
      extraction = await this.#extractor.extract(sourceSnapshot.absolutePath, parsedSource.kind);
    } finally {
      await sourceSnapshot.dispose();
    }
    if (extraction.format !== format) {
      throw new PigeDomainError("parser.office.format_mismatch", "The Office parser returned the wrong document format.");
    }
    return this.#artifacts.persist(vaultPath, parsedSource, sourceRecordPath, job, {
      format,
      parser,
      ...(extraction.title ? { title: extraction.title } : {}),
      text: extraction.text,
      textCharacterCount: extraction.textCharacterCount,
      textCoverage: extraction.textCoverage,
      truncated: extraction.truncated,
      needsOcr: extraction.needsOcr,
      agentTextReady: extraction.agentTextReady,
      ocrCandidateLocators: extraction.ocrCandidateLocators,
      sidecarMetadata: {
        unitCount: extraction.unitCount,
        processedUnitCount: extraction.processedUnitCount,
        unitsWithText: extraction.unitsWithText,
        entryCount: extraction.entryCount,
        totalUncompressedBytes: extraction.totalUncompressedBytes,
        structure: extraction.structure,
        mediaReferences: extraction.mediaReferences,
        units: extraction.units
      },
      sourceMetadata: {
        unitCount: extraction.unitCount,
        processedUnitCount: extraction.processedUnitCount,
        unitsWithText: extraction.unitsWithText,
        mediaCount: extraction.mediaReferences.length,
        officeStructure: extraction.structure
      },
      warnings: extraction.warnings
    });
  }
}
