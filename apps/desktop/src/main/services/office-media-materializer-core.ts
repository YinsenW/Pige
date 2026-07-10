import fs from "node:fs";
import { PigeDomainError } from "@pige/domain";
import { readOpenXmlMedia } from "./office-archive";
import {
  OFFICE_MEDIA_MATERIALIZER_ID,
  OFFICE_MEDIA_MATERIALIZER_VERSION,
  OFFICE_MEDIA_OCR_EXTENSIONS,
  type OfficeMediaMaterializerRequest,
  type OfficeMediaMaterializerResult,
  type OfficeMediaTarget
} from "./office-parser-types";

export async function materializeOfficeMedia(
  request: OfficeMediaMaterializerRequest
): Promise<OfficeMediaMaterializerResult> {
  validateRequest(request);
  return {
    materializerId: OFFICE_MEDIA_MATERIALIZER_ID,
    materializerVersion: OFFICE_MEDIA_MATERIALIZER_VERSION,
    media: await readOpenXmlMedia(request.filePath, request.targets, request.limits)
  };
}

function validateRequest(request: OfficeMediaMaterializerRequest): void {
  if (
    request.operation !== "materialize_pptx_media" ||
    request.sourceKind !== "pptx_file" ||
    !Array.isArray(request.targets) ||
    request.targets.length === 0 ||
    request.targets.length > request.limits.maxTargets ||
    request.targets.some((target) => !isValidTarget(target))
  ) {
    throw new PigeDomainError("ocr.pptx.media_target_invalid", "The PPTX media materializer target set is invalid.");
  }
  try {
    const stat = fs.lstatSync(request.filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not file");
    if (stat.size > request.limits.maxBytes) {
      throw new PigeDomainError("ocr.pptx.file_too_large", "The PPTX exceeds the media materializer source limit.");
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("ocr.pptx.source_missing", "The private PPTX media input is unavailable.");
  }
}

function isValidTarget(target: OfficeMediaTarget): boolean {
  return Number.isSafeInteger(target.slide) && target.slide > 0 &&
    Number.isSafeInteger(target.mediaIndex) && target.mediaIndex > 0 &&
    target.parentLocator === `slide:${target.slide}` &&
    target.locator === `${target.parentLocator}/media:${target.mediaIndex}` &&
    /^ppt\/media\/[^/\\]{1,900}$/u.test(target.packagePath) &&
    Number.isSafeInteger(target.size) && target.size > 0 &&
    OFFICE_MEDIA_OCR_EXTENSIONS.includes(target.extension as typeof OFFICE_MEDIA_OCR_EXTENSIONS[number]);
}
