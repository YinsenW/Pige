import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import {
  OperationRecordSchema,
  SourceRecordSchema,
  type JobRecord,
  type OperationRecord,
  type SourceRecord
} from "@pige/schemas";
import { createOcrDurableEffect, type OcrSourceResult } from "./ocr-artifact-service";
import { createContainedFileCommit } from "./contained-file-commit";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
  OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
  OFFICE_MEDIA_OCR_EXTENSIONS,
  type OfficeMediaTarget
} from "./office-parser-types";
import {
  verifiedOfficeMediaParserTargets,
  type OfficeMediaOcrFormat
} from "./office-media-ocr-target";
import { isSupportedNativeOcrIdentity, type NativeOcrResult } from "./ocr-types";
import { SourcePageService } from "./source-page-service";
import { tryVerifyReadableSourceFileAsync, verifyReadableSourceFileAsync } from "./source-file-access";
import { createVaultRelativePathResolver } from "./vault-layout";
import { observedOcrArtifactLanguage, sourceLanguageAfterOcr } from "./durable-language";

export interface PptxMediaOcrTargetReady {
  readonly ready: true;
  readonly materializableMediaCount: number;
  readonly skippedMediaCount: number;
  readonly message: string;
}

const { writeJsonAtomic, writeJsonAtomicAsync, writeTextAtomicAsync } = createContainedFileCommit({
  prepareSync: assertSafeWriteParentSync,
  verifySync: assertRealPathContainedSync,
  prepare: assertSafeWriteParent,
  verify: assertRealPathContained
});

export interface PptxMediaOcrTargetWaiting {
  readonly ready: false;
  readonly message: string;
}

export type PptxMediaOcrTargetInspection = PptxMediaOcrTargetReady | PptxMediaOcrTargetWaiting;

export interface VerifiedPptxMediaOcrTarget extends PptxMediaOcrTargetReady {
  readonly parserMetadataArtifactId: string;
  readonly parserMetadataChecksum: string;
  readonly nativeTextReady: boolean;
  readonly targets: readonly OfficeMediaTarget[];
}

export interface PptxMediaOcrItemResult {
  readonly target: OfficeMediaTarget;
  readonly mediaChecksum: string;
  readonly mediaSize: number;
  readonly result: NativeOcrResult;
}

export type { OfficeMediaOcrFormat } from "./office-media-ocr-target";
export type OfficeMediaOcrTargetReady = PptxMediaOcrTargetReady;
export type OfficeMediaOcrTargetInspection = PptxMediaOcrTargetInspection;
export type VerifiedOfficeMediaOcrTarget = VerifiedPptxMediaOcrTarget;
export type OfficeMediaOcrItemResult = PptxMediaOcrItemResult;

interface FileIntegrity {
  readonly checksum: string;
  readonly size: number;
}

interface SourceRecordSnapshot {
  readonly sourceRecord: SourceRecord;
  readonly fileChecksum: string;
}

interface AssembledPptxMediaOcr {
  readonly text: string;
  readonly units: readonly Record<string, unknown>[];
  readonly media: readonly Record<string, unknown>[];
  readonly confidence?: number;
  readonly languageHints: readonly string[];
  readonly warnings: readonly string[];
  readonly blockCount: number;
}

const MAX_PPTX_MEDIA_OCR_SIDECAR_BYTES = 32 * 1024 * 1024;
const MAX_SOURCE_RECORD_BYTES = 16 * 1024 * 1024;

export function inspectPptxMediaOcrTarget(sourceRecord: SourceRecord): PptxMediaOcrTargetInspection {
  if (sourceRecord.kind !== "pptx_file") {
    return { ready: false, message: "PPTX media OCR is waiting for verified local presentation metadata." };
  }
  return inspectOfficeMediaOcrTarget(sourceRecord);
}

export function inspectOfficeMediaOcrTarget(sourceRecord: SourceRecord): OfficeMediaOcrTargetInspection {
  const format = officeFormat(sourceRecord);
  const label = format.toUpperCase();
  const metadata = sourceRecord.metadata;
  if (
    metadata.parserFormat !== format ||
    (metadata.parserStatus !== "parsed_needs_ocr" && metadata.parserStatus !== "parsed")
  ) {
    return { ready: false, message: `${label} media OCR is waiting for verified local document metadata.` };
  }
  if (metadata.parserTruncated === true) {
    return { ready: false, message: `${label} media OCR is waiting because the parser did not inspect the complete document.` };
  }
  const unitCount = positiveInteger(metadata.unitCount);
  const processedUnitCount = positiveInteger(metadata.processedUnitCount);
  const candidateLocators = candidateLocatorArray(metadata.ocrCandidateLocators, format);
  const candidateMediaCount = positiveInteger(metadata.ocrCandidateMediaCount);
  const materializableMediaCount = positiveInteger(metadata.ocrMaterializableMediaCount);
  const materializableMediaBytes = positiveInteger(metadata.ocrMaterializableMediaBytes);
  if (
    unitCount === undefined ||
    processedUnitCount !== unitCount ||
    candidateLocators.length === 0 ||
    candidateMediaCount === undefined ||
    materializableMediaCount === undefined ||
    materializableMediaBytes === undefined ||
    materializableMediaCount > candidateMediaCount
  ) {
    return { ready: false, message: `${label} media OCR is waiting for a complete locator-correct media target set from the parser.` };
  }
  if (materializableMediaCount > OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS) {
    return {
      ready: false,
      message: `This document has ${materializableMediaCount} OCR-ready media targets; bounded local OCR currently supports at most ${OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS} per durable job.`
    };
  }
  if (materializableMediaBytes > OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES) {
    return { ready: false, message: `Selected ${label} media exceeds the bounded local OCR materializer limit.` };
  }
  if (materializableMediaCount === 0) {
    return { ready: false, message: `${label} image references are preserved, but none use a currently supported bounded raster format.` };
  }
  const skippedMediaCount = candidateMediaCount - materializableMediaCount;
  return {
    ready: true,
    materializableMediaCount,
    skippedMediaCount,
    message: skippedMediaCount > 0
      ? `${materializableMediaCount} ${label} media target(s) are ready for local OCR; ${skippedMediaCount} unsupported target(s) will remain visible as warnings.`
      : `${materializableMediaCount} ${label} media target(s) are ready for bounded local OCR.`
  };
}

export class OfficeMediaOcrArtifactService {
  readonly #sourcePages: SourcePageService;

  constructor(sourcePages = new SourcePageService()) {
    this.#sourcePages = sourcePages;
  }

  async resolveTarget(vaultPath: string, sourceRecord: SourceRecord): Promise<VerifiedPptxMediaOcrTarget> {
    const parsedSource = SourceRecordSchema.parse(sourceRecord);
    const format = officeFormat(parsedSource);
    const inspection = inspectOfficeMediaOcrTarget(parsedSource);
    if (!inspection.ready) {
      throw new PigeDomainError(`ocr.${format}.target_not_ready`, inspection.message);
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    const parserMetadataArtifact = parsedSource.artifacts.find((artifact) =>
      artifact.id === parserMetadataArtifactId(parsedSource.id, format) && artifact.kind === "metadata"
    );
    if (!parserMetadataArtifact?.checksum || parserMetadataArtifact.size === undefined) {
      throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `${format.toUpperCase()} media OCR has no verified parser metadata Artifact.`);
    }
    const sidecar = await readVerifiedJsonArtifact(
      vaultPath,
      parserMetadataArtifact,
      MAX_PPTX_MEDIA_OCR_SIDECAR_BYTES
    );
    const targets = verifiedOfficeMediaParserTargets(
      sidecar,
      parsedSource,
      sourceFile.checksum,
      inspection,
      format,
      parserMetadataArtifactId(parsedSource.id, format)
    );
    const nativeTextArtifact = parsedSource.artifacts.find((artifact) =>
      artifact.id === parserTextArtifactId(parsedSource.id, format) && artifact.kind === "extracted_text"
    );
    const nativeTextReady = sidecar?.agentTextReady === true;
    if (typeof sidecar?.extractedTextChecksum === "string") {
      if (
        !nativeTextArtifact ||
        nativeTextArtifact.checksum !== sidecar.extractedTextChecksum ||
        !await artifactFileMatches(vaultPath, nativeTextArtifact)
      ) {
        throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `${format.toUpperCase()} native text failed integrity verification before OCR enrichment.`);
      }
    } else if (nativeTextArtifact || nativeTextReady) {
      throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `${format.toUpperCase()} native-text readiness has no matching verified text Artifact.`);
    }
    return {
      ...inspection,
      parserMetadataArtifactId: parserMetadataArtifact.id,
      parserMetadataChecksum: parserMetadataArtifact.checksum,
      nativeTextReady,
      targets
    };
  }

  async readExisting(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    onPublicationStart?: () => void
  ): Promise<OcrSourceResult | undefined> {
    if (sourceRecord.kind !== "pptx_file" && sourceRecord.kind !== "docx_file") return undefined;
    const format = officeFormat(sourceRecord);
    const target = await this.resolveTarget(vaultPath, sourceRecord);
    const sourceFile = await tryVerifyReadableSourceFileAsync(vaultPath, sourceRecord);
    if (!sourceFile) return undefined;
    const metadataArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === mediaOcrMetadataArtifactId(sourceRecord.id, format) && artifact.kind === "metadata"
    );
    if (!metadataArtifact || !await artifactFileMatches(vaultPath, metadataArtifact)) return undefined;
    const textArtifact = sourceRecord.artifacts.find((artifact) =>
      artifact.id === mediaOcrTextArtifactId(sourceRecord.id, format) && artifact.kind === "ocr"
    );
    if (textArtifact && !await artifactFileMatches(vaultPath, textArtifact)) return undefined;
    const sidecar = await readVerifiedJsonArtifact(vaultPath, metadataArtifact, MAX_PPTX_MEDIA_OCR_SIDECAR_BYTES);
    if (!isReusableOcrSidecar(sidecar, sourceRecord, sourceFile.checksum, textArtifact, target, format)) return undefined;

    onPublicationStart?.();
    const page = this.#sourcePages.refreshForSource(vaultPath, sourceRecord, sourceRecordPath, job.id);
    const storedWarnings = stringArray(sidecar.warnings);
    const warnings = page.conflict ? [...storedWarnings, sourcePageConflictWarning()] : storedWarnings;
    const operation = writeOfficeMediaOcrOperation(vaultPath, sourceRecord, job, warnings, format);
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
      sourcePageConflict: page.conflict, durableEffect: createOcrDurableEffect(sourceRecord, operation)
    };
  }

  async persist(
    vaultPath: string,
    sourceRecord: SourceRecord,
    sourceRecordPath: string,
    job: JobRecord,
    itemResults: readonly PptxMediaOcrItemResult[]
  ): Promise<OcrSourceResult> {
    const requestedSource = SourceRecordSchema.parse(sourceRecord);
    if (requestedSource.kind !== "pptx_file" && requestedSource.kind !== "docx_file") {
      throw new PigeDomainError("ocr.office.source_unsupported", "Office media OCR accepts preserved DOCX or PPTX sources only.");
    }
    const format = officeFormat(requestedSource);
    const currentSource = await readCurrentSourceRecord(vaultPath, sourceRecordPath, requestedSource.id, format);
    const parsedSource = currentSource.sourceRecord;
    const target = await this.resolveTarget(vaultPath, parsedSource);
    const results = validateItemResults(target, itemResults, format);
    const firstResult = results[0]?.result;
    if (!firstResult) {
      throw new PigeDomainError(`ocr.${format}.result_invalid`, `${format.toUpperCase()} media OCR returned no attributable result.`);
    }
    const sourceFile = await verifyReadableSourceFileAsync(vaultPath, parsedSource);
    const assembled = assembleOfficeMediaOcr(target, results, format);
    const dateBucket = sourceDateBucket(parsedSource.id);
    const textArtifactPath = assembled.text.length > 0
      ? ["artifacts", "ocr", ...dateBucket, `${parsedSource.id}.${format}-media.txt`].join("/")
      : undefined;
    if (textArtifactPath) {
      await writeTextAtomicAsync(resolveVaultRelativePath(vaultPath, textArtifactPath), `${assembled.text}\n`, vaultPath);
    }
    const textIntegrity = textArtifactPath
      ? await fileIntegrity(resolveVaultRelativePath(vaultPath, textArtifactPath), `ocr.${format}.artifact_missing`)
      : undefined;
    const metadataArtifactPath = [
      "artifacts",
      "metadata",
      ...dateBucket,
      `${parsedSource.id}.${format}-media-ocr.json`
    ].join("/");
    const metadataAbsolutePath = resolveVaultRelativePath(vaultPath, metadataArtifactPath);
    const now = new Date().toISOString();
    const warnings = uniqueWarnings([
      ...assembled.warnings,
      ...(target.skippedMediaCount > 0 ? [`ocr_${format}_unsupported_media_skipped`] : [])
    ]);
    const ocrTextReady = Boolean(textIntegrity);
    const agentTextReady = target.nativeTextReady || ocrTextReady;
    await writeJsonAtomicAsync(metadataAbsolutePath, {
      schemaVersion: 1,
      artifactId: mediaOcrMetadataArtifactId(parsedSource.id, format),
      sourceId: parsedSource.id,
      kind: `${format}_media_ocr_metadata`,
      createdAt: now,
      sourceChecksum: sourceFile.checksum,
      sourceSize: sourceFile.size,
      sourceLocation: sourceFile.location,
      parserMetadataArtifactId: target.parserMetadataArtifactId,
      parserMetadataChecksum: target.parserMetadataChecksum,
      nativeTextReady: target.nativeTextReady,
      adapter: { id: firstResult.adapterId, version: firstResult.adapterVersion },
      ...(textIntegrity ? { ocrTextChecksum: textIntegrity.checksum } : {}),
      textCharacterCount: assembled.text.length,
      blockCount: assembled.blockCount,
      ...(assembled.confidence !== undefined ? { confidence: assembled.confidence } : {}),
      languageHints: assembled.languageHints,
      language: observedOcrArtifactLanguage(assembled.languageHints),
      targetCount: target.targets.length,
      skippedMediaCount: target.skippedMediaCount,
      complete: true,
      ocrTextReady,
      agentTextReady,
      media: assembled.media,
      units: assembled.units,
      warnings
    }, vaultPath);
    const metadataIntegrity = await fileIntegrity(metadataAbsolutePath, `ocr.${format}.artifact_missing`);
    const artifacts = upsertOfficeMediaOcrArtifacts(
      parsedSource,
      textArtifactPath,
      textIntegrity,
      metadataArtifactPath,
      metadataIntegrity,
      format
    );
    const engineIds = uniqueStrings(results.map((item) => item.result.engine));
    const engineVersions = uniqueStrings(results.map((item) => item.result.engineVersion));
    const updatedSource = SourceRecordSchema.parse({
      ...parsedSource,
      language: sourceLanguageAfterOcr(parsedSource.language, assembled.languageHints),
      artifacts,
      metadata: {
        ...parsedSource.metadata,
        ocrStatus: target.skippedMediaCount > 0
          ? "completed_with_unsupported_media"
          : textArtifactPath ? "completed" : "completed_empty",
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
        ocrProcessedMediaCount: results.length,
        ocrSkippedMediaCount: target.skippedMediaCount,
        ocrEnrichmentIncomplete: target.skippedMediaCount > 0,
        needsOcr: false,
        agentTextReady,
        ocrCompletedAt: now
      },
      updatedAt: now
    });
    writeSourceRecordAtomic(vaultPath, sourceRecordPath, updatedSource, currentSource.fileChecksum);
    const page = this.#sourcePages.refreshForSource(vaultPath, updatedSource, sourceRecordPath, job.id);
    const resultWarnings = page.conflict ? [...warnings, sourcePageConflictWarning()] : warnings;
    const operation = writeOfficeMediaOcrOperation(vaultPath, updatedSource, job, resultWarnings, format);
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
      sourcePageConflict: page.conflict, durableEffect: createOcrDurableEffect(updatedSource, operation)
    };
  }
}

export class PptxMediaOcrArtifactService extends OfficeMediaOcrArtifactService {}

function validateItemResults(
  target: VerifiedPptxMediaOcrTarget,
  itemResults: readonly PptxMediaOcrItemResult[],
  format: OfficeMediaOcrFormat
): readonly PptxMediaOcrItemResult[] {
  if (itemResults.length !== target.targets.length) {
    throw new PigeDomainError(`ocr.${format}.result_invalid`, `${format.toUpperCase()} media OCR did not return the complete selected target set.`);
  }
  for (let index = 0; index < target.targets.length; index += 1) {
    const expected = target.targets[index];
    const item = itemResults[index];
    if (
      !expected ||
      !item ||
      !sameTarget(item.target, expected) ||
      item.mediaSize !== expected.size ||
      !/^sha256:[a-f0-9]{64}$/u.test(item.mediaChecksum) ||
      !isSupportedNativeOcrIdentity(item.result) ||
      item.result.adapterId !== itemResults[0]?.result.adapterId ||
      item.result.adapterVersion !== itemResults[0]?.result.adapterVersion ||
      item.result.text !== item.result.blocks.map((block) => block.text).join("\n")
    ) {
      throw new PigeDomainError(`ocr.${format}.result_invalid`, `A ${format.toUpperCase()} media OCR result is inconsistent with the verified target.`);
    }
  }
  return itemResults;
}

function assembleOfficeMediaOcr(
  target: VerifiedPptxMediaOcrTarget,
  itemResults: readonly PptxMediaOcrItemResult[],
  format: OfficeMediaOcrFormat
): AssembledPptxMediaOcr {
  const chunks: string[] = [];
  const units: Record<string, unknown>[] = [];
  const media: Record<string, unknown>[] = [];
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
      const header = format === "pptx"
        ? `--- Slide ${item.target.slide} Media ${item.target.mediaIndex} ---\n`
        : `--- Document Image ${item.target.image} ---\n`;
      characterCursor += header.length;
      for (let index = 0; index < result.blocks.length; index += 1) {
        const block = result.blocks[index];
        if (!block) continue;
        const characterStart = characterCursor;
        const characterEnd = characterStart + block.text.length;
        units.push({
          locator: `${item.target.locator}/ocr:block:${index + 1}`,
          parentLocator: item.target.parentLocator,
          mediaLocator: item.target.locator,
          packagePath: item.target.packagePath,
          mediaChecksum: item.mediaChecksum,
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
    media.push({
      ...(format === "pptx" ? { slide: item.target.slide } : { documentImage: item.target.image }),
      locator: item.target.locator,
      parentLocator: item.target.parentLocator,
      packagePath: item.target.packagePath,
      extension: item.target.extension,
      mediaChecksum: item.mediaChecksum,
      mediaSize: item.mediaSize,
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
    media,
    ...(confidences.length > 0
      ? { confidence: confidences.reduce((total, value) => total + value, 0) / confidences.length }
      : {}),
    languageHints: uniqueStrings(languageHints),
    warnings: uniqueWarnings(warnings),
    blockCount
  };
}

function isReusableOcrSidecar(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  textArtifact: SourceRecord["artifacts"][number] | undefined,
  target: VerifiedPptxMediaOcrTarget,
  format: OfficeMediaOcrFormat
): sidecar is Record<string, unknown> {
  if (!sidecar) return false;
  const adapter = isRecord(sidecar.adapter) ? sidecar.adapter : undefined;
  const media = Array.isArray(sidecar.media) ? sidecar.media : [];
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== mediaOcrMetadataArtifactId(sourceRecord.id, format) ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== `${format}_media_ocr_metadata` ||
    sidecar.sourceChecksum !== sourceChecksum ||
    sidecar.parserMetadataArtifactId !== target.parserMetadataArtifactId ||
    sidecar.parserMetadataChecksum !== target.parserMetadataChecksum ||
    sidecar.nativeTextReady !== target.nativeTextReady ||
    sourceRecord.metadata.ocrAdapterId !== adapter?.id ||
    sourceRecord.metadata.ocrAdapterVersion !== adapter?.version ||
    sidecar.targetCount !== target.targets.length ||
    sidecar.skippedMediaCount !== target.skippedMediaCount ||
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
    media.length !== target.targets.length ||
    media.some((value, index) => {
      const expected = target.targets[index];
      const engine = isRecord(value) && isRecord(value.engine) ? value.engine : undefined;
      return !expected || !isRecord(value) ||
        (format === "pptx" ? value.slide !== expected.slide : value.documentImage !== expected.image) ||
        value.locator !== expected.locator ||
        value.parentLocator !== expected.parentLocator ||
        value.packagePath !== expected.packagePath ||
        value.extension !== expected.extension ||
        value.mediaSize !== expected.size ||
        typeof value.mediaChecksum !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(value.mediaChecksum) ||
        !isSupportedNativeOcrIdentity({
          adapterId: adapter?.id,
          adapterVersion: adapter?.version,
          engine: engine?.id,
          engineVersion: engine?.version
        });
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

function upsertOfficeMediaOcrArtifacts(
  sourceRecord: SourceRecord,
  textPath: string | undefined,
  textIntegrity: FileIntegrity | undefined,
  metadataPath: string,
  metadataIntegrity: FileIntegrity,
  format: OfficeMediaOcrFormat
): SourceRecord["artifacts"] {
  const replacedIds = new Set([
    mediaOcrTextArtifactId(sourceRecord.id, format),
    mediaOcrMetadataArtifactId(sourceRecord.id, format)
  ]);
  const artifacts = sourceRecord.artifacts.filter((artifact) => !replacedIds.has(artifact.id));
  const prioritized: SourceRecord["artifacts"] = [];
  if (textPath && textIntegrity) {
    prioritized.push({ id: mediaOcrTextArtifactId(sourceRecord.id, format), kind: "ocr", path: textPath, ...textIntegrity });
  }
  prioritized.push({
    id: mediaOcrMetadataArtifactId(sourceRecord.id, format),
    kind: "metadata",
    path: metadataPath,
    ...metadataIntegrity
  });
  return [...prioritized, ...artifacts];
}

function writeOfficeMediaOcrOperation(
  vaultPath: string,
  sourceRecord: SourceRecord,
  job: JobRecord,
  warnings: readonly string[],
  format: OfficeMediaOcrFormat
): OperationRecord {
  const operationId = createOperationId(job.id, sourceRecord.id, format);
  const dateKey = /^op_(\d{8})_/.exec(operationId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The OCR operation ID is invalid.");
  const operationPath = [".pige", "operations", dateKey.slice(0, 4), dateKey.slice(4, 6), `${operationId}.json`].join("/");
  const absolutePath = resolveVaultRelativePath(vaultPath, operationPath);
  if (fs.existsSync(absolutePath)) {
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR operation path is not a regular vault file.");
    }
    assertRealPathContainedSync(vaultPath, absolutePath);
    return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(absolutePath, "utf8")));
  }
  const targetIds = new Set([
    mediaOcrTextArtifactId(sourceRecord.id, format),
    mediaOcrMetadataArtifactId(sourceRecord.id, format)
  ]);
  const sourceIds = new Set([
    parserMetadataArtifactId(sourceRecord.id, format),
    parserTextArtifactId(sourceRecord.id, format)
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
    summary: `Recorded local embedded-media OCR artifacts for ${format.toUpperCase()} source ${sourceRecord.id}.`,
    reversible: "best_effort",
    rollbackHint: "Remove derived PPTX OCR artifacts only after confirming the Source Record no longer references them.",
    warnings: uniqueWarnings(warnings)
  });
  writeJsonAtomic(absolutePath, operation, vaultPath);
  return operation;
}

function createOperationId(jobId: string, sourceId: string, format: OfficeMediaOcrFormat): string {
  const dateKey = /^job_(\d{8})_/.exec(jobId)?.[1] ?? /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.operation_id_invalid", "The OCR operation has no valid date bucket.");
  const digest = createHash("sha256").update(`${jobId}:${sourceId}:${format}-media-ocr-artifacts`).digest("hex").slice(0, 12);
  return `op_${dateKey}_${digest}`;
}

function parserMetadataArtifactId(sourceId: string, format: OfficeMediaOcrFormat): string {
  return `art_${sourceId.replace(/^src_/u, "")}_${format}_metadata`;
}

function parserTextArtifactId(sourceId: string, format: OfficeMediaOcrFormat): string {
  return `art_${sourceId.replace(/^src_/u, "")}_${format}_text`;
}

function mediaOcrTextArtifactId(sourceId: string, format: OfficeMediaOcrFormat): string {
  return `art_${sourceId.replace(/^src_/u, "")}_${format}_media_ocr_text`;
}

function mediaOcrMetadataArtifactId(sourceId: string, format: OfficeMediaOcrFormat): string {
  return `art_${sourceId.replace(/^src_/u, "")}_${format}_media_ocr_metadata`;
}

function sourceDateBucket(sourceId: string): [string, string] {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new PigeDomainError("ocr.source_id_invalid", "The source ID has no valid date bucket.");
  return [dateKey.slice(0, 4), dateKey.slice(4, 6)];
}

async function readVerifiedJsonArtifact(
  vaultPath: string,
  artifact: SourceRecord["artifacts"][number],
  maxBytes: number
): Promise<Record<string, unknown> | undefined> {
  const verified = await verifyArtifactFile(vaultPath, artifact, maxBytes, true);
  if (!verified?.bytes) return undefined;
  try {
    const value = JSON.parse(verified.bytes.toString("utf8")) as unknown;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

async function artifactFileMatches(vaultPath: string, artifact: SourceRecord["artifacts"][number]): Promise<boolean> {
  return Boolean(await verifyArtifactFile(vaultPath, artifact));
}

async function verifyArtifactFile(
  vaultPath: string,
  artifact: SourceRecord["artifacts"][number],
  maxBytes = Number.MAX_SAFE_INTEGER,
  capture = false
): Promise<{ readonly bytes?: Buffer } | undefined> {
  if (!artifact.checksum || artifact.size === undefined || artifact.size < 0 || artifact.size > maxBytes) return undefined;
  const absolutePath = resolveVaultRelativePath(vaultPath, artifact.path);
  let file: fs.promises.FileHandle | undefined;
  try {
    const realPath = await fs.promises.realpath(absolutePath);
    await assertRealPathContained(vaultPath, realPath);
    file = await fs.promises.open(absolutePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = await file.stat();
    if (!before.isFile() || before.size !== artifact.size) return undefined;
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    const bytes = capture ? Buffer.alloc(before.size) : undefined;
    let position = 0;
    while (position < before.size) {
      const read = await file.read(buffer, 0, Math.min(buffer.length, before.size - position), position);
      if (read.bytesRead === 0) return undefined;
      const chunk = buffer.subarray(0, read.bytesRead);
      hash.update(chunk);
      if (bytes) chunk.copy(bytes, position);
      position += read.bytesRead;
    }
    const after = await file.stat();
    const realPathAfter = await fs.promises.realpath(absolutePath);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      realPathAfter !== realPath ||
      `sha256:${hash.digest("hex")}` !== artifact.checksum
    ) return undefined;
    return bytes ? { bytes } : {};
  } catch {
    return undefined;
  } finally {
    await file?.close().catch(() => undefined);
  }
}

async function fileIntegrity(filePath: string, errorCode: string): Promise<FileIntegrity> {
  const stat = await fs.promises.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new PigeDomainError(errorCode, "A PPTX OCR artifact was not written as a regular file.");
  }
  return { checksum: await checksumFile(filePath), size: stat.size };
}

async function checksumFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk as Buffer);
  }
  return `sha256:${hash.digest("hex")}`;
}

async function readCurrentSourceRecord(
  vaultPath: string,
  sourceRecordPath: string,
  expectedSourceId: string,
  format: OfficeMediaOcrFormat
): Promise<SourceRecordSnapshot> {
  const resolvedPath = resolveSourceRecordPath(vaultPath, sourceRecordPath);
  let file: fs.promises.FileHandle | undefined;
  try {
    const root = path.join(path.resolve(vaultPath), ".pige", "source-records");
    const [realVault, realRoot, realPath] = await Promise.all([
      fs.promises.realpath(vaultPath),
      fs.promises.realpath(root),
      fs.promises.realpath(resolvedPath)
    ]);
    if (!isContainedPath(realRoot, realVault) || !isContainedPath(realPath, realRoot)) {
      throw new PigeDomainError("ocr.path_outside_vault", "The Source Record resolves outside the active vault.");
    }
    file = await fs.promises.open(resolvedPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const before = await file.stat();
    if (!before.isFile() || before.size <= 0 || before.size > MAX_SOURCE_RECORD_BYTES) {
      throw new PigeDomainError("ocr.pptx.source_record_invalid", "The current PPTX Source Record is not a bounded regular file.");
    }
    const bytes = Buffer.alloc(before.size);
    let position = 0;
    while (position < before.size) {
      const read = await file.read(bytes, position, before.size - position, position);
      if (read.bytesRead === 0) throw new PigeDomainError("ocr.pptx.target_changed", "The PPTX Source Record changed during OCR.");
      position += read.bytesRead;
    }
    const after = await file.stat();
    const realPathAfter = await fs.promises.realpath(resolvedPath);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs ||
      realPathAfter !== realPath
    ) {
      throw new PigeDomainError("ocr.pptx.target_changed", "The PPTX Source Record changed during OCR.");
    }
    const parsed = SourceRecordSchema.parse(JSON.parse(bytes.toString("utf8")) as unknown);
    if (parsed.id !== expectedSourceId || parsed.kind !== `${format}_file`) {
      throw new PigeDomainError(`ocr.${format}.source_record_invalid`, `The current Source Record does not identify the expected ${format.toUpperCase()} source.`);
    }
    return {
      sourceRecord: parsed,
      fileChecksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("ocr.source_record_unavailable", "The current PPTX Source Record is unavailable.");
  } finally {
    await file?.close().catch(() => undefined);
  }
}

function writeSourceRecordAtomic(
  vaultPath: string,
  sourceRecordPath: string,
  sourceRecord: SourceRecord,
  expectedFileChecksum: string
): void {
  const resolvedPath = resolveSourceRecordPath(vaultPath, sourceRecordPath);
  assertSafeWriteParentSync(vaultPath, resolvedPath);
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(resolvedPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const descriptorStat = fs.fstatSync(descriptor);
    const pathStat = fs.lstatSync(resolvedPath);
    if (
      !descriptorStat.isFile() ||
      !pathStat.isFile() ||
      pathStat.isSymbolicLink() ||
      descriptorStat.dev !== pathStat.dev ||
      descriptorStat.ino !== pathStat.ino ||
      descriptorStat.size <= 0 ||
      descriptorStat.size > MAX_SOURCE_RECORD_BYTES
    ) {
      throw new PigeDomainError("ocr.source_record_unavailable", "The PPTX Source Record is unavailable.");
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < descriptorStat.size) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, Math.min(buffer.length, descriptorStat.size - position), position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    if (position !== descriptorStat.size || `sha256:${hash.digest("hex")}` !== expectedFileChecksum) {
      throw new PigeDomainError("ocr.pptx.target_changed", "The PPTX Source Record changed before OCR could commit its result.");
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("ocr.source_record_unavailable", "The PPTX Source Record is unavailable.");
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
  writeJsonAtomic(resolvedPath, sourceRecord, vaultPath);
}

function resolveSourceRecordPath(vaultPath: string, sourceRecordPath: string): string {
  const resolvedVault = path.resolve(vaultPath);
  const root = path.join(resolvedVault, ".pige", "source-records");
  const resolvedPath = path.isAbsolute(sourceRecordPath)
    ? path.resolve(sourceRecordPath)
    : resolveVaultRelativePath(vaultPath, sourceRecordPath);
  if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The Source Record path escapes the active vault.");
  }
  return resolvedPath;
}

const resolveVaultRelativePath = createVaultRelativePathResolver(
  () => new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR path escapes the active vault.")
);

async function assertSafeWriteParent(vaultPath: string, filePath: string): Promise<void> {
  assertLexicalPathContained(vaultPath, filePath);
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const [realVault, realParent] = await Promise.all([
    fs.promises.realpath(vaultPath),
    fs.promises.realpath(path.dirname(filePath))
  ]);
  if (!isContainedPath(realParent, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR write parent resolves outside the active vault.");
  }
  const existing = await fs.promises.lstat(filePath).catch(() => undefined);
  if (existing?.isSymbolicLink() || (existing && !existing.isFile())) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR write target is not a regular vault file.");
  }
}

function assertSafeWriteParentSync(vaultPath: string, filePath: string): void {
  assertLexicalPathContained(vaultPath, filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const realVault = fs.realpathSync(vaultPath);
  const realParent = fs.realpathSync(path.dirname(filePath));
  if (!isContainedPath(realParent, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR write parent resolves outside the active vault.");
  }
  try {
    const existing = fs.lstatSync(filePath);
    if (existing.isSymbolicLink() || !existing.isFile()) {
      throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR write target is not a regular vault file.");
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
  }
}

async function assertRealPathContained(vaultPath: string, filePath: string): Promise<void> {
  const [realVault, realFile] = await Promise.all([
    fs.promises.realpath(vaultPath),
    fs.promises.realpath(filePath)
  ]);
  if (!isContainedPath(realFile, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR write escaped the active vault.");
  }
}

function assertRealPathContainedSync(vaultPath: string, filePath: string): void {
  const realVault = fs.realpathSync(vaultPath);
  const realFile = fs.realpathSync(filePath);
  if (!isContainedPath(realFile, realVault)) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR write escaped the active vault.");
  }
}

function assertLexicalPathContained(vaultPath: string, filePath: string): void {
  if (!isContainedPath(path.resolve(filePath), path.resolve(vaultPath))) {
    throw new PigeDomainError("ocr.path_outside_vault", "The PPTX OCR path escapes the active vault.");
  }
}

function isContainedPath(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function sameTarget(left: OfficeMediaTarget, right: OfficeMediaTarget): boolean {
  return left.slide === right.slide &&
    left.image === right.image &&
    left.parentLocator === right.parentLocator &&
    left.mediaIndex === right.mediaIndex &&
    left.locator === right.locator &&
    left.packagePath === right.packagePath &&
    left.size === right.size &&
    left.extension === right.extension;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function candidateLocatorArray(value: unknown, format: OfficeMediaOcrFormat): string[] {
  if (!Array.isArray(value)) return [];
  const pattern = format === "pptx" ? /^slide:[1-9]\d*$/u : /^image:[1-9]\d*$/u;
  const locators = value.filter((item): item is string => typeof item === "string" && pattern.test(item));
  return new Set(locators).size === locators.length ? locators : [];
}

function officeFormat(sourceRecord: SourceRecord): OfficeMediaOcrFormat {
  if (sourceRecord.kind === "docx_file") return "docx";
  if (sourceRecord.kind === "pptx_file") return "pptx";
  throw new PigeDomainError("ocr.office.source_unsupported", "Office media OCR accepts DOCX or PPTX sources only.");
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
