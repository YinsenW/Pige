import { createHash } from "node:crypto";
import fs from "node:fs";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  SourceRecordSchema,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import { createOcrDurableEffect, type OcrSourceResult } from "./ocr-artifact-service";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_VERSION
} from "./office-parser-types";
import {
  PPTX_SLIDE_MATERIALIZER_ID,
  PPTX_SLIDE_MATERIALIZER_MAX_SLIDES,
  PPTX_SLIDE_MATERIALIZER_VERSION
} from "./pptx-slide-materializer-core";
import { isSupportedNativeOcrIdentity, type NativeOcrResult } from "./ocr-types";
import { SourcePageService } from "./source-page-service";
import { tryVerifyReadableSourceFileAsync, verifyReadableSourceFileAsync } from "./source-file-access";
import { observedOcrArtifactLanguage, sourceLanguageAfterOcr } from "./durable-language";
import {
  artifactFileMatches,
  assertRealPathContainedSync,
  fileIntegrity,
  parserMetadataArtifactId,
  parserTextArtifactId,
  readCurrentSourceRecord,
  readVerifiedJsonArtifact,
  resolveVaultRelativePath,
  sourceDateBucket,
  writeJsonAtomic,
  writeJsonAtomicAsync,
  writeSourceRecordAtomic,
  writeTextAtomicAsync,
  type FileIntegrity
} from "./pptx-media-ocr-artifact-service";

const MAX_PPTX_SLIDE_OCR_SIDECAR_BYTES = 32 * 1024 * 1024;

export interface PptxSlideOcrTargetReady {
  readonly ready: true;
  readonly materializableSlideCount: number;
  readonly skippedSlideCount: number;
  readonly message: string;
}

export interface PptxSlideOcrTargetWaiting {
  readonly ready: false;
  readonly message: string;
}

export type PptxSlideOcrTargetInspection = PptxSlideOcrTargetReady | PptxSlideOcrTargetWaiting;

export interface VerifiedPptxSlideOcrTarget extends PptxSlideOcrTargetReady {
  readonly parserMetadataArtifactId: string;
  readonly parserMetadataChecksum: string;
  readonly nativeTextReady: boolean;
  readonly slideLocators: readonly string[];
}

export interface PptxSlideOcrMaterializationInfo {
  readonly materializerId: string;
  readonly materializerVersion: string;
  readonly parserMetadataChecksum: string;
  readonly warnings: readonly string[];
  readonly renderIncomplete: boolean;
}

export interface PptxSlideOcrItemResult {
  readonly slide: number;
  readonly locator: string;
  readonly renderChecksum: string;
  readonly renderSize: number;
  readonly width: number;
  readonly height: number;
  readonly result: NativeOcrResult;
}

export function inspectPptxSlideOcrTarget(sourceRecord: SourceRecord): PptxSlideOcrTargetInspection {
  if (sourceRecord.kind !== "pptx_file") {
    return { ready: false, message: "PPTX slide OCR is waiting for verified local presentation metadata." };
  }
  const metadata = sourceRecord.metadata;
  if (
    metadata.parserFormat !== "pptx" ||
    (metadata.parserStatus !== "parsed_needs_ocr" && metadata.parserStatus !== "parsed")
  ) {
    return { ready: false, message: "PPTX slide OCR is waiting for verified local presentation metadata." };
  }
  if (metadata.parserTruncated === true) {
    return { ready: false, message: "PPTX slide OCR is waiting because the parser did not inspect the complete presentation." };
  }
  const unitCount = positiveInteger(metadata.unitCount);
  const processedUnitCount = positiveInteger(metadata.processedUnitCount);
  const slideLocators = candidateLocatorArray(metadata.ocrCandidateLocators, "pptx");
  const candidateSlideCount = positiveInteger(metadata.ocrCandidateSlideCount);
  if (
    unitCount === undefined ||
    processedUnitCount !== unitCount ||
    slideLocators.length === 0 ||
    (candidateSlideCount !== undefined && candidateSlideCount !== slideLocators.length)
  ) {
    return { ready: false, message: "PPTX slide OCR is waiting for a complete locator-correct slide target set from the parser." };
  }
  if (slideLocators.length > PPTX_SLIDE_MATERIALIZER_MAX_SLIDES) {
    return {
      ready: false,
      message: `This presentation has ${slideLocators.length} OCR-ready slides; bounded local OCR currently supports at most ${PPTX_SLIDE_MATERIALIZER_MAX_SLIDES} per durable job.`
    };
  }
  return {
    ready: true,
    materializableSlideCount: slideLocators.length,
    skippedSlideCount: 0,
    message: `${slideLocators.length} PPTX slide(s) are ready for bounded full-slide OCR.`
  };
}


export class PptxSlideOcrArtifactAdapter {
  readonly #sourcePages: SourcePageService;

  constructor(sourcePages = new SourcePageService()) {
    this.#sourcePages = sourcePages;
  }

  async resolvePptxSlideTarget(vaultPath: string, sourceRecord: SourceRecord): Promise<VerifiedPptxSlideOcrTarget> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    const inspection = inspectPptxSlideOcrTarget(parsedSource);
    if (!inspection.ready) {
      throw new PigeDomainError("ocr.pptx.target_not_ready", inspection.message);
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    const parserMetadataArtifact = parsedSource.artifacts.find((artifact) =>
      artifact.id === parserMetadataArtifactId(parsedSource.id, "pptx") && artifact.kind === "metadata"
    );
    if (!parserMetadataArtifact?.checksum || parserMetadataArtifact.size === undefined) {
      throw new PigeDomainError("ocr.pptx.parser_metadata_invalid", "PPTX slide OCR has no verified parser metadata Artifact.");
    }
    const sidecar = await readVerifiedJsonArtifact(vaultPath, parserMetadataArtifact, MAX_PPTX_SLIDE_OCR_SIDECAR_BYTES);
    const slideLocators = verifiedPptxSlideParserLocators(
      sidecar,
      parsedSource,
      sourceFile.checksum,
      inspection,
      parserMetadataArtifactId(parsedSource.id, "pptx")
    );
    const nativeTextArtifact = parsedSource.artifacts.find((artifact) =>
      artifact.id === parserTextArtifactId(parsedSource.id, "pptx") && artifact.kind === "extracted_text"
    );
    const nativeTextReady = sidecar?.agentTextReady === true;
    if (typeof sidecar?.extractedTextChecksum === "string") {
      if (
        !nativeTextArtifact ||
        nativeTextArtifact.checksum !== sidecar.extractedTextChecksum ||
        !await artifactFileMatches(vaultPath, nativeTextArtifact)
      ) {
        throw new PigeDomainError("ocr.pptx.parser_metadata_invalid", "PPTX native text failed integrity verification before slide OCR enrichment.");
      }
    } else if (nativeTextArtifact || nativeTextReady) {
      throw new PigeDomainError("ocr.pptx.parser_metadata_invalid", "PPTX native-text readiness has no matching verified text Artifact.");
    }
    return {
      ...inspection,
      parserMetadataArtifactId: parserMetadataArtifact.id,
      parserMetadataChecksum: parserMetadataArtifact.checksum,
      nativeTextReady,
      slideLocators
    };
  }

  async readExistingPptxSlides(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    onPublicationStart?: () => void
  ): Promise<OcrSourceResult | undefined> {
    if (sourceRecord.kind !== "pptx_file") return undefined;
    const target = await this.resolvePptxSlideTarget(vaultPath, sourceRecord);
    const sourceFile = await tryVerifyReadableSourceFileAsync(vaultPath, sourceRecord);
    if (!sourceFile) return undefined;
    const metadataArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === pptxSlideOcrMetadataArtifactId(sourceRecord.id) && artifact.kind === "metadata"
    );
    if (!metadataArtifact || !await artifactFileMatches(vaultPath, metadataArtifact)) return undefined;
    const textArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === pptxSlideOcrTextArtifactId(sourceRecord.id) && artifact.kind === "ocr"
    );
    if (textArtifact && !await artifactFileMatches(vaultPath, textArtifact)) return undefined;
    const sidecar = await readVerifiedJsonArtifact(vaultPath, metadataArtifact, MAX_PPTX_SLIDE_OCR_SIDECAR_BYTES);
    if (!isReusablePptxSlideOcrSidecar(sidecar, sourceRecord, sourceFile.checksum, textArtifact, target)) return undefined;

    onPublicationStart?.();
    const page = this.#sourcePages.refreshForSource(vaultPath, sourceRecord, sourceRecordPath, job.id);
    const storedWarnings = stringArray(sidecar.warnings);
    const warnings = page.conflict ? [...storedWarnings, sourcePageConflictWarning()] : storedWarnings;
    const operation = writePptxSlideOcrOperation(vaultPath, sourceRecord, job, warnings);
    const confidence = normalizedNumber(sidecar.confidence);
    return {
      sourceId: sourceRecord.id,
      created: false,
      ...(textArtifact ? { ocrTextArtifactPath: textArtifact.path } : {}),
      metadataArtifactPath: metadataArtifact.path,
      textCharacterCount: nonNegativeInteger(sidecar.textCharacterCount),
      ...(confidence !== undefined ? { confidence } : {}),
      agentTextReady: sidecar.agentTextReady === true,
      warnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict,
      durableEffect: createOcrDurableEffect(sourceRecord, operation)
    };
  }

  async persistPptxSlides(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    itemResults: readonly PptxSlideOcrItemResult[],
    materialization: PptxSlideOcrMaterializationInfo
  ): Promise<OcrSourceResult> {
    const requestedSource = SourceRecordSchema.parse(sourceRecord);
    if (requestedSource.kind !== "pptx_file") {
      throw new PigeDomainError("ocr.pptx.source_unsupported", "PPTX slide OCR accepts preserved PPTX sources only.");
    }
    const currentSource = await readCurrentSourceRecord(vaultPath, sourceRecordPath, requestedSource.id, "pptx");
    const parsedSource = currentSource.sourceRecord;
    const target = await this.resolvePptxSlideTarget(vaultPath, parsedSource);
    const results = validatePptxSlideResults(target, itemResults);
    const firstResult = results[0]?.result;
    if (!firstResult) {
      throw new PigeDomainError("ocr.pptx.result_invalid", "PPTX slide OCR returned no attributable result.");
    }
    if (
      materialization.materializerId !== PPTX_SLIDE_MATERIALIZER_ID ||
      materialization.materializerVersion !== PPTX_SLIDE_MATERIALIZER_VERSION ||
      materialization.parserMetadataChecksum !== target.parserMetadataChecksum
    ) {
      throw new PigeDomainError("ocr.pptx.materializer_result_invalid", "The PPTX slide materializer provenance is invalid.");
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    const assembled = assemblePptxSlideOcr(target, results);
    const dateBucket = sourceDateBucket(parsedSource.id);
    const textArtifactPath = assembled.text.length > 0
      ? ["artifacts", "ocr", ...dateBucket, `${parsedSource.id}.pptx-slide.txt`].join("/")
      : undefined;
    if (textArtifactPath) {
      await writeTextAtomicAsync(resolveVaultRelativePath(vaultPath, textArtifactPath), `${assembled.text}\n`, vaultPath);
    }
    const textIntegrity = textArtifactPath
      ? await fileIntegrity(resolveVaultRelativePath(vaultPath, textArtifactPath), "ocr.pptx.artifact_missing")
      : undefined;
    const metadataArtifactPath = [
      "artifacts",
      "metadata",
      ...dateBucket,
      `${parsedSource.id}.pptx-slide-ocr.json`
    ].join("/");
    const metadataAbsolutePath = resolveVaultRelativePath(vaultPath, metadataArtifactPath);
    const now = new Date().toISOString();
    const warnings = uniqueWarnings([
      ...materialization.warnings,
      ...assembled.warnings,
      ...(materialization.renderIncomplete ? ["pptx_slide_render_incomplete"] : [])
    ]);
    const ocrTextReady = Boolean(textIntegrity);
    const agentTextReady = target.nativeTextReady || ocrTextReady;
    await writeJsonAtomicAsync(metadataAbsolutePath, {
      schemaVersion: 1,
      artifactId: pptxSlideOcrMetadataArtifactId(parsedSource.id),
      sourceId: parsedSource.id,
      kind: "pptx_slide_ocr_metadata",
      createdAt: now,
      sourceChecksum: sourceFile.checksum,
      sourceSize: sourceFile.size,
      sourceLocation: sourceFile.location,
      parserMetadataArtifactId: target.parserMetadataArtifactId,
      parserMetadataChecksum: target.parserMetadataChecksum,
      nativeTextReady: target.nativeTextReady,
      materializer: {
        id: materialization.materializerId,
        version: materialization.materializerVersion
      },
      adapter: { id: firstResult.adapterId, version: firstResult.adapterVersion },
      ...(textIntegrity ? { ocrTextChecksum: textIntegrity.checksum } : {}),
      textCharacterCount: assembled.text.length,
      blockCount: assembled.blockCount,
      ...(assembled.confidence !== undefined ? { confidence: assembled.confidence } : {}),
      languageHints: assembled.languageHints,
      language: observedOcrArtifactLanguage(assembled.languageHints),
      targetCount: target.slideLocators.length,
      complete: true,
      renderIncomplete: materialization.renderIncomplete,
      ocrTextReady,
      agentTextReady,
      slides: assembled.slides,
      units: assembled.units,
      warnings
    }, vaultPath);
    const metadataIntegrity = await fileIntegrity(metadataAbsolutePath, "ocr.pptx.artifact_missing");
    const artifacts = upsertPptxSlideOcrArtifacts(
      parsedSource,
      textArtifactPath,
      textIntegrity,
      metadataArtifactPath,
      metadataIntegrity
    );
    const engineIds = uniqueStrings(results.map((item) => item.result.engine));
    const engineVersions = uniqueStrings(results.map((item) => item.result.engineVersion));
    const updatedSource = SourceRecordSchema.parse({
      ...parsedSource,
      language: sourceLanguageAfterOcr(parsedSource.language, assembled.languageHints),
      artifacts,
      metadata: {
        ...parsedSource.metadata,
        ocrStatus: textArtifactPath ? "completed" : "completed_empty",
        ocrAdapterId: firstResult.adapterId,
        ocrAdapterVersion: firstResult.adapterVersion,
        ocrEngine: engineIds.length === 1 ? engineIds[0] : "mixed_local_ocr",
        ocrEngineVersions: engineVersions,
        ocrJobId: job.id,
        ocrTextCharacterCount: assembled.text.length,
        ocrBlockCount: assembled.blockCount,
        ...(assembled.confidence !== undefined ? { ocrConfidence: assembled.confidence } : {}),
        ocrLanguageHints: assembled.languageHints,
        ocrWarnings: warnings,
        ocrProcessedSlideCount: results.length,
        ocrSkippedSlideCount: 0,
        ocrSlideLocators: target.slideLocators,
        ocrMaterializerId: materialization.materializerId,
        ocrMaterializerVersion: materialization.materializerVersion,
        ocrRenderIncomplete: materialization.renderIncomplete,
        ocrEnrichmentIncomplete: materialization.renderIncomplete,
        needsOcr: false,
        agentTextReady,
        ocrCompletedAt: now
      },
      updatedAt: now
    });
    writeSourceRecordAtomic(vaultPath, sourceRecordPath, updatedSource, currentSource.fileChecksum, "pptx");
    const page = this.#sourcePages.refreshForSource(vaultPath, updatedSource, sourceRecordPath, job.id);
    const resultWarnings = page.conflict ? [...warnings, sourcePageConflictWarning()] : warnings;
    const operation = writePptxSlideOcrOperation(vaultPath, updatedSource, job, resultWarnings);
    return {
      sourceId: parsedSource.id,
      created: true,
      ...(textArtifactPath ? { ocrTextArtifactPath: textArtifactPath } : {}),
      metadataArtifactPath,
      textCharacterCount: assembled.text.length,
      ...(assembled.confidence !== undefined ? { confidence: assembled.confidence } : {}),
      agentTextReady,
      warnings: resultWarnings,
      sourcePageUpdated: page.updated,
      sourcePageConflict: page.conflict,
      durableEffect: createOcrDurableEffect(updatedSource, operation)
    };
  }

}
function verifiedPptxSlideParserLocators(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  inspection: PptxSlideOcrTargetReady,
  expectedArtifactId: string
): readonly string[] {
  const parser = isRecord(sidecar?.parser) ? sidecar.parser : undefined;
  const units = Array.isArray(sidecar?.units) ? sidecar.units : [];
  const candidateLocators = candidateLocatorArray(sidecar?.ocrCandidateLocators, "pptx");
  const sourceLocators = candidateLocatorArray(sourceRecord.metadata.ocrCandidateLocators, "pptx");
  if (
    !sidecar ||
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== expectedArtifactId ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== "pptx_parse_metadata" ||
    sidecar.sourceChecksum !== sourceChecksum ||
    parser?.id !== OFFICE_PARSER_ID ||
    parser.engine !== OFFICE_PARSER_ENGINE ||
    parser.version !== OFFICE_PARSER_VERSION ||
    sourceRecord.metadata.parserFormat !== "pptx" ||
    sourceRecord.metadata.parserId !== parser.id ||
    sourceRecord.metadata.parserEngine !== parser.engine ||
    sourceRecord.metadata.parserVersion !== parser.version ||
    sidecar.truncated !== false ||
    sidecar.needsOcr !== true ||
    !Number.isSafeInteger(sidecar.unitCount) ||
    sidecar.unitCount !== sidecar.processedUnitCount ||
    units.length !== sidecar.unitCount ||
    !sameStringArray(candidateLocators, sourceLocators) ||
    candidateLocators.length !== inspection.materializableSlideCount ||
    candidateLocators.some((locator) => !/^slide:[1-9]\d*$/u.test(locator))
  ) {
    throw new PigeDomainError("ocr.pptx.parser_metadata_invalid", "The PPTX slide OCR target does not match verified parser metadata.");
  }
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    if (!isRecord(unit) || unit.index !== index + 1 || unit.locator !== `slide:${index + 1}` || typeof unit.needsOcr !== "boolean") {
      throw new PigeDomainError("ocr.pptx.parser_metadata_invalid", "A PPTX parser unit has invalid slide provenance.");
    }
  }
  return candidateLocators;
}

function validatePptxSlideResults(
  target: VerifiedPptxSlideOcrTarget,
  itemResults: readonly PptxSlideOcrItemResult[]
): readonly PptxSlideOcrItemResult[] {
  if (itemResults.length !== target.slideLocators.length) {
    throw new PigeDomainError("ocr.pptx.result_invalid", "PPTX slide OCR did not return the complete selected slide set.");
  }
  for (let index = 0; index < target.slideLocators.length; index += 1) {
    const expectedLocator = target.slideLocators[index];
    const expectedSlide = expectedLocator ? Number(/^slide:(\d+)$/u.exec(expectedLocator)?.[1]) : NaN;
    const item = itemResults[index];
    if (
      !expectedLocator ||
      !item ||
      item.slide !== expectedSlide ||
      item.locator !== `${expectedLocator}/render` ||
      !Number.isSafeInteger(item.renderSize) ||
      item.renderSize <= 0 ||
      !Number.isSafeInteger(item.width) ||
      !Number.isSafeInteger(item.height) ||
      item.width <= 0 ||
      item.height <= 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.renderChecksum) ||
      !isSupportedNativeOcrIdentity(item.result) ||
      item.result.adapterId !== itemResults[0]?.result.adapterId ||
      item.result.adapterVersion !== itemResults[0]?.result.adapterVersion ||
      item.result.text !== item.result.blocks.map((block) => block.text).join("\n")
    ) {
      throw new PigeDomainError("ocr.pptx.result_invalid", "A PPTX slide OCR result is inconsistent with the verified rendered target.");
    }
  }
  return itemResults;
}

interface AssembledPptxSlideOcr {
  readonly text: string;
  readonly units: readonly Record<string, unknown>[];
  readonly slides: readonly Record<string, unknown>[];
  readonly confidence?: number;
  readonly languageHints: readonly string[];
  readonly warnings: readonly string[];
  readonly blockCount: number;
}

function assemblePptxSlideOcr(
  target: VerifiedPptxSlideOcrTarget,
  itemResults: readonly PptxSlideOcrItemResult[]
): AssembledPptxSlideOcr {
  const chunks: string[] = [];
  const units: Record<string, unknown>[] = [];
  const slides: Record<string, unknown>[] = [];
  const confidences: number[] = [];
  const languageHints: string[] = [];
  const warnings: string[] = [];
  let characterCursor = 0;
  let blockCount = 0;
  for (const item of itemResults) {
    const result = item.result;
    const itemWarnings = uniqueWarnings(result.warnings);
    warnings.push(...itemWarnings);
    languageHints.push(...result.languageHints);
    if (result.confidence !== undefined) confidences.push(result.confidence);
    if (result.text.length > 0) {
      if (chunks.length > 0) characterCursor += 2;
      const header = `--- Slide ${item.slide} Render ---\n`;
      characterCursor += header.length;
      for (let index = 0; index < result.blocks.length; index += 1) {
        const block = result.blocks[index];
        if (!block) continue;
        const characterStart = characterCursor;
        const characterEnd = characterStart + block.text.length;
        units.push({
          locator: `${item.locator}/ocr:block:${index + 1}`,
          parentLocator: `slide:${item.slide}`,
          renderLocator: item.locator,
          renderChecksum: item.renderChecksum,
          renderSize: item.renderSize,
          characterStart,
          characterEnd,
          kind: block.kind,
          confidence: block.confidence,
          boundingBox: block.boundingBox,
          languageHints: block.languageHints,
          isTitle: block.isTitle
        });
        characterCursor = characterEnd + (index < result.blocks.length - 1 ? 1 : 0);
        blockCount += 1;
      }
      chunks.push(`${header}${result.text}`);
    }
    slides.push({
      slide: item.slide,
      locator: item.locator,
      renderChecksum: item.renderChecksum,
      renderSize: item.renderSize,
      width: item.width,
      height: item.height,
      engine: { id: result.engine, version: result.engineVersion },
      textCharacterCount: result.text.length,
      blockCount: result.blocks.length,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      languageHints: result.languageHints,
      image: result.image,
      warnings: itemWarnings
    });
  }
  return {
    text: chunks.join("\n\n"),
    units,
    slides,
    ...(confidences.length > 0
      ? { confidence: confidences.reduce((total, value) => total + value, 0) / confidences.length }
      : {}),
    languageHints: uniqueStrings(languageHints),
    warnings: uniqueWarnings(warnings),
    blockCount
  };
}

function isReusablePptxSlideOcrSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  textArtifact: SourceRecord["artifacts"][number] | undefined,
  target: VerifiedPptxSlideOcrTarget
): sidecar is Record<string, unknown> {
  const adapter = isRecord(sidecar?.adapter) ? sidecar.adapter : undefined;
  const materializer = isRecord(sidecar?.materializer) ? sidecar.materializer : undefined;
  const slides = Array.isArray(sidecar?.slides) ? sidecar.slides : [];
  if (
    !sidecar ||
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== pptxSlideOcrMetadataArtifactId(sourceRecord.id) ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== "pptx_slide_ocr_metadata" ||
    sidecar.sourceChecksum !== sourceChecksum ||
    sidecar.parserMetadataArtifactId !== target.parserMetadataArtifactId ||
    sidecar.parserMetadataChecksum !== target.parserMetadataChecksum ||
    sidecar.nativeTextReady !== target.nativeTextReady ||
    materializer?.id !== PPTX_SLIDE_MATERIALIZER_ID ||
    materializer.version !== PPTX_SLIDE_MATERIALIZER_VERSION ||
    sourceRecord.metadata.ocrAdapterId !== adapter?.id ||
    sourceRecord.metadata.ocrAdapterVersion !== adapter?.version ||
    sidecar.targetCount !== target.slideLocators.length ||
    sidecar.complete !== true ||
    !Number.isSafeInteger(sidecar.textCharacterCount) ||
    (sidecar.textCharacterCount as number) < 0 ||
    !Number.isSafeInteger(sidecar.blockCount) ||
    (sidecar.blockCount as number) < 0 ||
    typeof sidecar.ocrTextReady !== "boolean" ||
    typeof sidecar.agentTextReady !== "boolean" ||
    !Array.isArray(sidecar.units) ||
    !Array.isArray(sidecar.warnings) ||
    sidecar.warnings.some((warning) => typeof warning !== "string") ||
    sourceRecord.metadata.needsOcr !== false ||
    sourceRecord.metadata.agentTextReady !== sidecar.agentTextReady ||
    slides.length !== target.slideLocators.length ||
    slides.some((value, index) => {
      const expected = target.slideLocators[index];
      const slide = isRecord(value) ? value : undefined;
      return !slide ||
        slide.locator !== `${expected}/render` ||
        !Number.isSafeInteger(slide.slide) ||
        slide.slide !== Number(/^slide:(\d+)$/u.exec(expected ?? "")?.[1]) ||
        !Number.isSafeInteger(slide.renderSize) ||
        (slide.renderSize as number) <= 0 ||
        !Number.isSafeInteger(slide.width) ||
        !Number.isSafeInteger(slide.height) ||
        typeof slide.renderChecksum !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(slide.renderChecksum);
    })
  ) return false;
  if (!textArtifact) {
    return sidecar.ocrTextChecksum === undefined &&
      sidecar.textCharacterCount === 0 &&
      sidecar.ocrTextReady === false &&
      sidecar.agentTextReady === target.nativeTextReady;
  }
  return sidecar.ocrTextChecksum === textArtifact.checksum &&
    sidecar.ocrTextReady === true &&
    sidecar.agentTextReady === true;
}

function upsertPptxSlideOcrArtifacts(
  sourceRecord: SourceRecord,
  textPath: string | undefined,
  textIntegrity: FileIntegrity | undefined,
  metadataPath: string,
  metadataIntegrity: FileIntegrity
): SourceRecord["artifacts"] {
  const replacedIds = new Set([
    pptxSlideOcrTextArtifactId(sourceRecord.id),
    pptxSlideOcrMetadataArtifactId(sourceRecord.id)
  ]);
  const artifacts = sourceRecord.artifacts.filter((artifact) => !replacedIds.has(artifact.id));
  const prioritized: SourceRecord["artifacts"] = [];
  if (textPath && textIntegrity) {
    prioritized.push({ id: pptxSlideOcrTextArtifactId(sourceRecord.id), kind: "ocr", path: textPath, ...textIntegrity });
  }
  prioritized.push({
    id: pptxSlideOcrMetadataArtifactId(sourceRecord.id),
    kind: "metadata",
    path: metadataPath,
    ...metadataIntegrity
  });
  return [...prioritized, ...artifacts];
}

function writePptxSlideOcrOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  warnings: readonly string[]
): OperationRecord {
  const operationId = createPptxSlideOperationId(job.id, sourceRecord.id);
  const dateKey = /^op_(\d{8})_/u.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The PPTX slide OCR operation ID is invalid.");
  const operationPath = [".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`].join("/");
  const absolutePath = resolveVaultRelativePath(vaultPath, operationPath);
  if (fs.existsSync(absolutePath)) {
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new PigeDomainError("ocr.path_outside_vault", "The PPTX slide OCR operation path is not a regular vault file.");
    }
    assertRealPathContainedSync(vaultPath, absolutePath);
    return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(absolutePath, "utf8")));
  }
  const targetIds = new Set([
    pptxSlideOcrTextArtifactId(sourceRecord.id),
    pptxSlideOcrMetadataArtifactId(sourceRecord.id)
  ]);
  const sourceIds = new Set([
    parserMetadataArtifactId(sourceRecord.id, "pptx"),
    parserTextArtifactId(sourceRecord.id, "pptx")
  ]);
  const operation = OperationRecordSchema.parse({
    id: operationId,
    schemaVersion: 1,
    jobId: job.id,
    createdAt: new Date().toISOString(),
    actor: { kind: "system", runtimeKind: "desktop_local", clientCapabilityTier: "desktop_full" },
    kind: "create_artifact",
    targetRefs: sourceRecord.artifacts
      .filter((artifact) => targetIds.has(artifact.id))
      .map((artifact) => ({ kind: "artifact", id: artifact.id, path: artifact.path })),
    sourceRefs: [
      { kind: "job", id: job.id },
      { kind: "source", id: sourceRecord.id },
      ...sourceRecord.artifacts
        .filter((artifact) => sourceIds.has(artifact.id))
        .map((artifact) => ({ kind: "artifact" as const, id: artifact.id, path: artifact.path }))
    ],
    summary: `Recorded local full-slide OCR artifacts for PPTX source ${sourceRecord.id}.`,
    reversible: "best_effort",
    rollbackHint: "Remove derived PPTX slide OCR artifacts only after confirming the Source Record no longer references them.",
    warnings: uniqueWarnings(warnings)
  });
  writeJsonAtomic(absolutePath, operation, vaultPath);
  return operation;
}

function pptxSlideOcrTextArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pptx_slide_ocr_text`;
}

function pptxSlideOcrMetadataArtifactId(sourceId: string): string {
  return `art_${sourceId.replace(/^src_/u, "")}_pptx_slide_ocr_metadata`;
}

function createPptxSlideOperationId(jobId: string, sourceId: string): string {
  const dateKey = /^job_(\d{8})_/u.exec(jobId)?.[1] ?? /^src_(\d{8})_/u.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The PPTX slide OCR operation has no valid date bucket.");
  const digest = createHash("sha256").update(`${jobId}:${sourceId}:pptx-slide-ocr-artifacts`).digest("hex").slice(0, 12);
  return `op_${dateKey}_${digest}`;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function candidateLocatorArray(value: unknown, format: "pptx"): string[] {
  if (!Array.isArray(value)) return [];
  const pattern = format === "pptx" ? /^slide:[1-9]\d*$/u : /^image:[1-9]\d*$/u;
  const locators = value.filter((item): item is string => typeof item === "string" && pattern.test(item));
  return new Set(locators).size === locators.length ? locators : [];
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function nonNegativeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : 0;
}

function normalizedNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function uniqueStrings(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueWarnings(values: readonly string[]): string[] {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/gu, " ").trim()).filter(Boolean))).slice(0, 64);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sourcePageConflictWarning(): string {
  return "The source page was edited after capture, so Pige preserved the edit and did not replace its body.";
}
