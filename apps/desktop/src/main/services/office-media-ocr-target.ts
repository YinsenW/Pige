import { PigeDomainError } from "@pige/domain";
import type { SourceRecord } from "@pige/schemas";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_OCR_EXTENSIONS,
  OFFICE_MEDIA_TARGET_SCHEMA_VERSION,
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_VERSION,
  type OfficeMediaTarget
} from "./office-parser-types";

export type OfficeMediaOcrFormat = "docx" | "pptx";

interface MaterializableTargetInspection {
  readonly materializableMediaCount: number;
}

export function verifiedOfficeMediaParserTargets(
  sidecar: Record<string, unknown> | undefined,
  sourceRecord: SourceRecord,
  sourceChecksum: string,
  inspection: MaterializableTargetInspection,
  format: OfficeMediaOcrFormat,
  expectedArtifactId: string
): readonly OfficeMediaTarget[] {
  const label = format.toUpperCase();
  if (!sidecar) {
    throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `The ${label} parser metadata Artifact is unavailable.`);
  }
  const parser = isRecord(sidecar.parser) ? sidecar.parser : undefined;
  const units = Array.isArray(sidecar.units) ? sidecar.units : [];
  const candidateLocators = candidateLocatorArray(sidecar.ocrCandidateLocators, format);
  if (
    sidecar.schemaVersion !== 1 ||
    sidecar.artifactId !== expectedArtifactId ||
    sidecar.sourceId !== sourceRecord.id ||
    sidecar.kind !== `${format}_parse_metadata` ||
    sidecar.sourceChecksum !== sourceChecksum ||
    sidecar.mediaTargetSchemaVersion !== OFFICE_MEDIA_TARGET_SCHEMA_VERSION ||
    parser?.id !== OFFICE_PARSER_ID ||
    parser.engine !== OFFICE_PARSER_ENGINE ||
    parser.version !== OFFICE_PARSER_VERSION ||
    sourceRecord.metadata.parserFormat !== format ||
    sourceRecord.metadata.parserId !== OFFICE_PARSER_ID ||
    sourceRecord.metadata.parserEngine !== OFFICE_PARSER_ENGINE ||
    sourceRecord.metadata.parserVersion !== OFFICE_PARSER_VERSION ||
    sidecar.truncated !== false ||
    sidecar.needsOcr !== true ||
    !Number.isSafeInteger(sidecar.unitCount) ||
    sidecar.unitCount !== sidecar.processedUnitCount ||
    units.length !== sidecar.unitCount ||
    !sameStringArray(candidateLocators, candidateLocatorArray(sourceRecord.metadata.ocrCandidateLocators, format))
  ) {
    throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `The ${label} OCR target does not match verified parser metadata.`);
  }

  const targets: OfficeMediaTarget[] = [];
  let candidateMediaCount = 0;
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index];
    const unitIndex = index + 1;
    if (!isRecord(unit) || unit.index !== unitIndex || typeof unit.needsOcr !== "boolean") {
      throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `A ${label} parser unit has invalid provenance.`);
    }
    if (
      (format === "pptx" && unit.locator !== `slide:${unitIndex}`) ||
      (format === "docx" && unit.locator !== `block:${unitIndex}`)
    ) {
      throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `A ${label} parser unit has invalid locator provenance.`);
    }
    const mediaReferences = Array.isArray(unit.mediaReferences) ? unit.mediaReferences : [];
    if (!unit.needsOcr) continue;
    const locatorBound = format === "pptx"
      ? candidateLocators.includes(unit.locator as string)
      : mediaReferences.every((media) => isRecord(media) && typeof media.locator === "string" && candidateLocators.includes(media.locator));
    if (!locatorBound || mediaReferences.length === 0) {
      throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `A ${label} OCR candidate has no locator-correct media references.`);
    }
    candidateMediaCount += mediaReferences.length;
    for (let mediaOffset = 0; mediaOffset < mediaReferences.length; mediaOffset += 1) {
      const media = mediaReferences[mediaOffset];
      const mediaIndex = format === "pptx" ? mediaOffset + 1 : positiveInteger(isRecord(media) ? media.mediaIndex : undefined);
      const docxImage = format === "docx" && isRecord(media) && typeof media.locator === "string"
        ? positiveInteger(Number(/^image:(\d+)$/u.exec(media.locator)?.[1]))
        : undefined;
      if (
        !isRecord(media) ||
        mediaIndex === undefined ||
        media.mediaIndex !== mediaIndex ||
        (format === "pptx" && media.locator !== `slide:${unitIndex}/media:${mediaIndex}`) ||
        (format === "docx" && (docxImage === undefined || media.locator !== `image:${docxImage}`)) ||
        typeof media.packagePath !== "string" ||
        !(format === "pptx" ? /^ppt\/media\/[^/\\]{1,900}$/u : /^word\/media\/[^/\\]{1,900}$/u).test(media.packagePath) ||
        !Number.isSafeInteger(media.size) ||
        (media.size as number) <= 0 ||
        typeof media.extension !== "string"
      ) {
        throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `A ${label} media reference has invalid package provenance.`);
      }
      if (
        (media.size as number) <= OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM &&
        OFFICE_MEDIA_OCR_EXTENSIONS.includes(media.extension as typeof OFFICE_MEDIA_OCR_EXTENSIONS[number])
      ) {
        targets.push({
          ...(format === "pptx" ? { slide: unitIndex } : { image: docxImage! }),
          parentLocator: format === "pptx" ? `slide:${unitIndex}` : `image:${docxImage}`,
          mediaIndex,
          locator: media.locator as string,
          packagePath: media.packagePath,
          size: media.size as number,
          extension: media.extension
        });
      }
    }
  }
  if (
    candidateMediaCount !== positiveInteger(sourceRecord.metadata.ocrCandidateMediaCount) ||
    targets.length !== inspection.materializableMediaCount ||
    targets.reduce((total, target) => total + target.size, 0) !== positiveInteger(sourceRecord.metadata.ocrMaterializableMediaBytes) ||
    new Set(targets.map((target) => target.locator)).size !== targets.length
  ) {
    throw new PigeDomainError(`ocr.${format}.parser_metadata_invalid`, `${label} media targets do not match the Source Record projection.`);
  }
  return targets;
}

function candidateLocatorArray(value: unknown, format: OfficeMediaOcrFormat): string[] {
  if (!Array.isArray(value)) return [];
  const pattern = format === "pptx" ? /^slide:[1-9]\d*$/u : /^image:[1-9]\d*$/u;
  const locators = value.filter((item): item is string => typeof item === "string" && pattern.test(item));
  return new Set(locators).size === locators.length ? locators : [];
}

function positiveInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : undefined;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
