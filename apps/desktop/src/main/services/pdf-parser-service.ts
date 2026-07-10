import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type JobRecord, type SourceKind, type SourceRecord } from "@pige/schemas";
import { PDF_PARSER_WORKER_ENTRY_RELATIVE_PATH } from "../../shared/pdf-parser-entry";
import { JobCancellationError, type JobExecutionControl } from "./job-execution-control";
import {
  ParserArtifactService,
  type DocumentParseSourceResult
} from "./parser-artifact-service";
import { createVerifiedSourceFileSnapshotAsync } from "./source-file-access";
import {
  PDF_PARSER_MAX_BYTES,
  PDF_PARSER_MAX_PAGES,
  PDF_PARSER_TIMEOUT_MS,
  PDF_PARSER_ENGINE,
  PDF_PARSER_ID,
  PDF_PARSER_VERSION,
  type PdfExtractionResult,
  type PdfParserRequest,
  type PdfParserWorkerResponse
} from "./pdf-parser-types";

export interface PdfTextExtractor {
  isAvailable?(): boolean;
  extract(filePath: string, signal?: AbortSignal): Promise<PdfExtractionResult>;
}

export type PdfParseSourceResult = DocumentParseSourceResult;

export class PdfParserWorkerAdapter implements PdfTextExtractor {
  readonly #timeoutMs: number;
  readonly #workerUrl: URL;
  readonly #resolveModule: (moduleId: string) => string;

  constructor(
    workerUrl = new URL(PDF_PARSER_WORKER_ENTRY_RELATIVE_PATH, import.meta.url),
    timeoutMs = PDF_PARSER_TIMEOUT_MS,
    resolveModule: (moduleId: string) => string = (moduleId) => createRequire(import.meta.url).resolve(moduleId)
  ) {
    this.#workerUrl = workerUrl;
    this.#timeoutMs = timeoutMs;
    this.#resolveModule = resolveModule;
  }

  isAvailable(): boolean {
    try {
      return Boolean(
        this.#resolveModule("pdfjs-dist/package.json") &&
        this.#resolveModule("@napi-rs/canvas/package.json")
      );
    } catch {
      return false;
    }
  }

  extract(filePath: string, signal?: AbortSignal): Promise<PdfExtractionResult> {
    if (signal?.aborted) return Promise.reject(new JobCancellationError());
    const request: PdfParserRequest = {
      requestId: randomUUID(),
      filePath,
      limits: { maxBytes: PDF_PARSER_MAX_BYTES, maxPages: PDF_PARSER_MAX_PAGES }
    };

    return new Promise((resolve, reject) => {
      const worker = new Worker(this.#workerUrl, {
        name: "pige-pdf-parser",
        resourceLimits: { maxOldGenerationSizeMb: 512 }
      });
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        if (timeout) clearTimeout(timeout);
        signal?.removeEventListener("abort", onAbort);
        void worker.terminate();
        callback();
      };
      const onAbort = (): void => {
        finish(() => reject(new JobCancellationError()));
      };
      timeout = setTimeout(() => {
        finish(() => reject(new PigeDomainError("parser.pdf.timeout", "PDF text extraction exceeded the local time limit.")));
      }, this.#timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      worker.once("message", (message: PdfParserWorkerResponse) => {
        if (!message || message.requestId !== request.requestId) {
          finish(() => reject(new PigeDomainError("parser.pdf.worker_protocol", "The PDF parser worker returned an invalid response.")));
          return;
        }
        if (message.ok) {
          finish(() => resolve(message.result));
          return;
        }
        finish(() => reject(new PigeDomainError(message.error.code, message.error.message)));
      });
      worker.once("error", () => {
        finish(() => reject(new PigeDomainError("parser.pdf.worker_failed", "The PDF parser worker failed.")));
      });
      worker.once("exit", (code) => {
        if (!settled && code !== 0) {
          finish(() => reject(new PigeDomainError("parser.pdf.worker_failed", "The PDF parser worker exited before completing.")));
        }
      });
      worker.postMessage(request);
    });
  }
}

export class PdfParserService {
  readonly #extractor: PdfTextExtractor;
  readonly #artifacts: ParserArtifactService;

  constructor(extractor: PdfTextExtractor = new PdfParserWorkerAdapter(), artifacts = new ParserArtifactService()) {
    this.#extractor = extractor;
    this.#artifacts = artifacts;
  }

  canParse(sourceKind: SourceKind): boolean {
    return sourceKind === "pdf_file" && this.#extractor.isAvailable?.() !== false;
  }

  async parseSource(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    control?: JobExecutionControl
  ): Promise<PdfParseSourceResult> {
    control?.throwIfCancellationRequested();
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    if (parsedSource.kind !== "pdf_file") {
      throw new PigeDomainError("parser.unsupported_source", "The PDF parser cannot process this source kind.");
    }
    const existing = this.#artifacts.readExisting(vaultPath, parsedSource, sourceRecordPath, job, "pdf", {
      id: PDF_PARSER_ID,
      engine: PDF_PARSER_ENGINE,
      version: PDF_PARSER_VERSION
    }, () => control?.markDurableCheckpoint("pdf_parser_artifact_publication_started"));
    if (existing) return existing;

    control?.throwIfCancellationRequested();
    const sourceSnapshot = await createVerifiedSourceFileSnapshotAsync(vaultPath, parsedSource);
    let extraction: PdfExtractionResult;
    try {
      extraction = await this.#extractor.extract(sourceSnapshot.absolutePath, control?.signal);
    } finally {
      await sourceSnapshot.dispose();
    }
    control?.throwIfCancellationRequested();
    return this.#artifacts.persist(vaultPath, parsedSource, sourceRecordPath, job, {
      format: "pdf",
      parser: {
        id: extraction.parserId,
        engine: extraction.engine,
        version: extraction.engineVersion
      },
      ...(extraction.title ? { title: extraction.title } : {}),
      text: extraction.text,
      textCharacterCount: extraction.textCharacterCount,
      textCoverage: extraction.textCoverage,
      truncated: extraction.truncated,
      needsOcr: extraction.needsOcr,
      agentTextReady: extraction.agentTextReady,
      ocrCandidateLocators: extraction.ocrCandidatePages.map((page) => `page:${page}`),
      sidecarMetadata: {
        pageCount: extraction.pageCount,
        processedPageCount: extraction.processedPageCount,
        pagesWithText: extraction.pagesWithText,
        ocrCandidatePages: extraction.ocrCandidatePages,
        pages: extraction.pages.map((page) => ({
          page: page.page,
          locator: page.locator,
          characterCount: page.characterCount,
          ...(page.characterStart !== undefined ? { characterStart: page.characterStart } : {}),
          ...(page.characterEnd !== undefined ? { characterEnd: page.characterEnd } : {}),
          needsOcr: page.needsOcr,
          warnings: page.warnings
        }))
      },
      sourceMetadata: {
        pageCount: extraction.pageCount,
        processedPageCount: extraction.processedPageCount,
        pagesWithText: extraction.pagesWithText,
        ocrCandidatePages: extraction.ocrCandidatePages
      },
      warnings: extraction.warnings
    }, () => control?.markDurableCheckpoint("pdf_parser_artifact_publication_started"));
  }
}
