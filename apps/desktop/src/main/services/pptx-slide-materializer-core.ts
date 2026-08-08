import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from "@napi-rs/canvas";
import { PigeDomainError } from "@pige/domain";
import { XMLParser } from "fast-xml-parser";
import { readOpenXmlMedia, readOpenXmlPackage, type OpenXmlPackage } from "./office-archive";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_TIMEOUT_MS,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_VERSION,
  type OfficeMediaTarget,
  type OfficeParserLimits
} from "./office-parser-types";

export const PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION = 1 as const;
export const PPTX_SLIDE_MATERIALIZER_ID = "pige_openxml_canvas" as const;
export const PPTX_SLIDE_MATERIALIZER_VERSION = "1" as const;
export const PPTX_SLIDE_MATERIALIZER_MAX_SLIDES = 12;
export const PPTX_SLIDE_MATERIALIZER_MAX_EDGE = 2_048;
export const PPTX_SLIDE_MATERIALIZER_MAX_PIXELS = 4_194_304;
export const PPTX_SLIDE_MATERIALIZER_MAX_PNG_BYTES_PER_SLIDE = 12 * 1024 * 1024;
export const PPTX_SLIDE_MATERIALIZER_MAX_TOTAL_PNG_BYTES = 48 * 1024 * 1024;
export const PPTX_SLIDE_MATERIALIZER_TIMEOUT_MS = 60_000;
export const PPTX_SLIDE_MATERIALIZER_WORKER_OLD_GENERATION_MB = 512;

const XML_PARSER = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: false,
  processEntities: false,
  maxNestedTags: 100,
  strictReservedNames: true
});

const RENDERABLE_MEDIA_EXTENSIONS = new Set([".bmp", ".jpeg", ".jpg", ".png", ".webp"]);
const MAX_TEXT_RUNS_PER_SLIDE = 10_000;
const MAX_SHAPES_PER_SLIDE = 10_000;
const EMU_PER_INCH = 914_400;

export interface PptxSlideMaterializerLimits {
  readonly maxBytes: number;
  readonly maxEntries: number;
  readonly maxUncompressedBytes: number;
  readonly maxSelectedXmlBytes: number;
  readonly maxSlides: number;
  readonly maxEdge: number;
  readonly maxPixels: number;
  readonly maxPngBytesPerSlide: number;
  readonly maxTotalPngBytes: number;
  readonly timeoutMs: number;
}

export const PPTX_SLIDE_MATERIALIZER_DEFAULT_LIMITS: PptxSlideMaterializerLimits = Object.freeze({
  maxBytes: OFFICE_PARSER_MAX_BYTES,
  maxEntries: OFFICE_PARSER_MAX_ENTRIES,
  maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  maxSlides: PPTX_SLIDE_MATERIALIZER_MAX_SLIDES,
  maxEdge: PPTX_SLIDE_MATERIALIZER_MAX_EDGE,
  maxPixels: PPTX_SLIDE_MATERIALIZER_MAX_PIXELS,
  maxPngBytesPerSlide: PPTX_SLIDE_MATERIALIZER_MAX_PNG_BYTES_PER_SLIDE,
  maxTotalPngBytes: PPTX_SLIDE_MATERIALIZER_MAX_TOTAL_PNG_BYTES,
  timeoutMs: PPTX_SLIDE_MATERIALIZER_TIMEOUT_MS
});

export interface PptxSlideMaterializerParserBinding {
  readonly artifactId: string;
  readonly checksum: string;
  readonly sourceChecksum: string;
  readonly parserId: typeof OFFICE_PARSER_ID;
  readonly parserEngine: typeof OFFICE_PARSER_ENGINE;
  readonly parserVersion: typeof OFFICE_PARSER_VERSION;
  readonly slideLocators: readonly string[];
}

export interface PptxSlideMaterializerRequest {
  readonly protocolVersion: typeof PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly filePath: string;
  readonly sourceChecksum: string;
  readonly parser: PptxSlideMaterializerParserBinding;
  readonly slideLocators: readonly string[];
  readonly limits: PptxSlideMaterializerLimits;
}

export interface PptxRenderedSlide {
  readonly slide: number;
  readonly locator: string;
  readonly mimeType: "image/png";
  readonly png: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly pngByteSize: number;
  readonly warnings: readonly string[];
}

export interface PptxSlideMaterializerResult {
  readonly protocolVersion: typeof PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION;
  readonly materializerId: typeof PPTX_SLIDE_MATERIALIZER_ID;
  readonly materializerVersion: typeof PPTX_SLIDE_MATERIALIZER_VERSION;
  readonly sourceChecksum: string;
  readonly parserMetadataChecksum: string;
  readonly requestedSlides: readonly number[];
  readonly renderedSlides: readonly number[];
  readonly slides: readonly PptxRenderedSlide[];
  readonly totalPngByteSize: number;
  readonly warnings: readonly string[];
  readonly renderIncomplete: boolean;
}

export interface PptxSlideMaterializerPort {
  isAvailable(): boolean;
  materialize(request: PptxSlideMaterializerRequest): Promise<PptxSlideMaterializerResult>;
}

export class PptxSlideMaterializerService implements PptxSlideMaterializerPort {
  isAvailable(): boolean {
    return true;
  }

  materialize(request: PptxSlideMaterializerRequest): Promise<PptxSlideMaterializerResult> {
    return materializePptxSlides(request);
  }
}

interface OrderedNode {
  readonly [key: string]: unknown;
}

interface Relationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

interface SlideGeometry {
  readonly widthEmu: number;
  readonly heightEmu: number;
}

interface RenderState {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

export async function materializePptxSlides(value: unknown): Promise<PptxSlideMaterializerResult> {
  const request = parseRequest(value);
  const startedAt = Date.now();
  const source = await readVerifiedSource(request.filePath, request.sourceChecksum, request.limits.maxBytes);
  checkDeadline(startedAt, request.limits.timeoutMs);

  const parserLimits: OfficeParserLimits = {
    maxBytes: request.limits.maxBytes,
    maxEntries: request.limits.maxEntries,
    maxUncompressedBytes: request.limits.maxUncompressedBytes,
    maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
    maxSelectedXmlBytes: request.limits.maxSelectedXmlBytes,
    maxSlides: OFFICE_PARSER_MAX_SLIDES,
    maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS
  };
  const packageData = await readOpenXmlPackage(request.filePath, "pptx", parserLimits);
  checkDeadline(startedAt, request.limits.timeoutMs);
  const slideParts = orderedSlideParts(packageData);
  const requestedSlides = request.slideLocators.map((locator) => slideNumber(locator));
  if (requestedSlides.some((slide) => slide > slideParts.length)) {
    throw materializerError("parser.pptx.slide_out_of_range", "A selected PPTX slide is outside the presentation.");
  }

  const geometry = readSlideGeometry(packageData);
  const renderSize = boundedRenderSize(geometry, request.limits);
  const targets = collectMediaTargets(packageData, slideParts, requestedSlides);
  const media = targets.length > 0
    ? await readOpenXmlMedia(request.filePath, targets, {
        maxBytes: request.limits.maxBytes,
        maxEntries: request.limits.maxEntries,
        maxUncompressedBytes: request.limits.maxUncompressedBytes,
        maxTargets: request.limits.maxSlides,
        maxBytesPerItem: OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
        maxTotalBytes: request.limits.maxTotalPngBytes
      }, "pptx")
    : [];
  const mediaByLocator = new Map(media.map((item) => [item.locator, item.bytes]));

  const slides: PptxRenderedSlide[] = [];
  const warnings: string[] = [];
  let totalPngByteSize = 0;
  let renderIncomplete = false;
  for (const slide of requestedSlides) {
    checkDeadline(startedAt, request.limits.timeoutMs);
    const part = slideParts[slide - 1];
    if (!part) throw materializerError("parser.pptx.slide_out_of_range", "A selected PPTX slide is outside the presentation.");
    const slideXml = packageData.entries.get(part);
    if (!slideXml) {
      renderIncomplete = true;
      warnings.push(`slide:${slide}:missing_xml`);
      continue;
    }
    const slideRelsPart = `${path.posix.dirname(part)}/_rels/${path.posix.basename(part)}.rels`;
    const relationships = packageData.entries.has(slideRelsPart)
      ? parseRelationships(packageData.entries.get(slideRelsPart)!, part)
      : [];
    const canvas = createCanvas(renderSize.width, renderSize.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, renderSize.width, renderSize.height);
    const slideWarnings = await renderSlide(
      context,
      parseXml(slideXml),
      relationships,
      mediaByLocator,
      renderSize,
      slide
    );
    let encoded: Buffer;
    try {
      encoded = canvas.toBuffer("image/png");
    } finally {
      releaseCanvas(canvas);
    }
    if (encoded.byteLength > request.limits.maxPngBytesPerSlide) {
      renderIncomplete = true;
      warnings.push(`slide:${slide}:png_limit_exceeded`);
      continue;
    }
    if (totalPngByteSize + encoded.byteLength > request.limits.maxTotalPngBytes) {
      renderIncomplete = true;
      warnings.push(`slide:${slide}:aggregate_png_limit_exceeded`);
      break;
    }
    const rendered: PptxRenderedSlide = {
      slide,
      locator: `slide:${slide}/render`,
      mimeType: "image/png",
      png: Uint8Array.from(encoded),
      width: renderSize.width,
      height: renderSize.height,
      pngByteSize: encoded.byteLength,
      warnings: slideWarnings
    };
    slides.push(rendered);
    totalPngByteSize += encoded.byteLength;
    if (slideWarnings.length > 0) {
      renderIncomplete = true;
      warnings.push(...slideWarnings.map((warning) => `slide:${slide}:${warning}`));
    }
  }

  return {
    protocolVersion: PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION,
    materializerId: PPTX_SLIDE_MATERIALIZER_ID,
    materializerVersion: PPTX_SLIDE_MATERIALIZER_VERSION,
    sourceChecksum: source.checksum,
    parserMetadataChecksum: request.parser.checksum,
    requestedSlides,
    renderedSlides: slides.map((slide) => slide.slide),
    slides,
    totalPngByteSize,
    warnings: uniqueWarnings(warnings),
    renderIncomplete
  };
}

function parseRequest(value: unknown): PptxSlideMaterializerRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["protocolVersion", "requestId", "filePath", "sourceChecksum", "parser", "slideLocators", "limits"])) {
    throw materializerError("parser.pptx.materializer_invalid_request", "The PPTX slide materializer request is invalid.");
  }
  if (
    value.protocolVersion !== PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION ||
    !isRequestId(value.requestId) ||
    typeof value.filePath !== "string" ||
    !path.isAbsolute(value.filePath) ||
    value.filePath.length > 32_768 ||
    value.filePath.includes("\u0000") ||
    !isChecksum(value.sourceChecksum) ||
    !isRecord(value.parser) ||
    !Array.isArray(value.slideLocators) ||
    value.slideLocators.length === 0 ||
    value.slideLocators.length > PPTX_SLIDE_MATERIALIZER_MAX_SLIDES ||
    !isRecord(value.limits)
  ) {
    throw materializerError("parser.pptx.materializer_invalid_request", "The PPTX slide materializer request is invalid.");
  }
  const parser = parseParserBinding(value.parser);
  const slideLocators = parseSlideLocators(value.slideLocators);
  const limits = parseLimits(value.limits);
  if (!isChecksum(parser.sourceChecksum) || parser.sourceChecksum !== value.sourceChecksum || !sameStrings(parser.slideLocators, slideLocators)) {
    throw materializerError("parser.pptx.materializer_provenance_mismatch", "The PPTX slide materializer provenance is stale.");
  }
  return {
    protocolVersion: PPTX_SLIDE_MATERIALIZER_PROTOCOL_VERSION,
    requestId: value.requestId,
    filePath: value.filePath,
    sourceChecksum: value.sourceChecksum,
    parser,
    slideLocators,
    limits
  };
}

function parseParserBinding(value: Record<string, unknown>): PptxSlideMaterializerParserBinding {
  if (!hasExactKeys(value, ["artifactId", "checksum", "sourceChecksum", "parserId", "parserEngine", "parserVersion", "slideLocators"]) ||
    typeof value.artifactId !== "string" || !value.artifactId || !isChecksum(value.checksum) ||
    typeof value.sourceChecksum !== "string" || value.parserId !== OFFICE_PARSER_ID ||
    value.parserEngine !== OFFICE_PARSER_ENGINE || value.parserVersion !== OFFICE_PARSER_VERSION ||
    !Array.isArray(value.slideLocators)) {
    throw materializerError("parser.pptx.materializer_provenance_mismatch", "The PPTX parser provenance is invalid.");
  }
  return {
    artifactId: value.artifactId,
    checksum: value.checksum,
    sourceChecksum: value.sourceChecksum,
    parserId: OFFICE_PARSER_ID,
    parserEngine: OFFICE_PARSER_ENGINE,
    parserVersion: OFFICE_PARSER_VERSION,
    slideLocators: parseSlideLocators(value.slideLocators)
  };
}

function parseSlideLocators(value: readonly unknown[]): string[] {
  const locators = value.map((item) => {
    if (typeof item !== "string" || !/^slide:[1-9]\d*$/u.test(item)) {
      throw materializerError("parser.pptx.materializer_invalid_slide", "PPTX slide locators must be positive slide references.");
    }
    return item;
  });
  if (new Set(locators).size !== locators.length) {
    throw materializerError("parser.pptx.materializer_invalid_slide", "PPTX slide locators must be unique.");
  }
  return locators;
}

function parseLimits(value: Record<string, unknown>): PptxSlideMaterializerLimits {
  const fields = ["maxBytes", "maxEntries", "maxUncompressedBytes", "maxSelectedXmlBytes", "maxSlides", "maxEdge", "maxPixels", "maxPngBytesPerSlide", "maxTotalPngBytes", "timeoutMs"] as const;
  if (!hasExactKeys(value, fields) || fields.some((field) => !isPositiveSafeInteger(value[field]))) {
    throw materializerError("parser.pptx.materializer_invalid_request", "The PPTX slide materializer limits are invalid.");
  }
  const limits = value as unknown as PptxSlideMaterializerLimits;
  if (limits.maxSlides > PPTX_SLIDE_MATERIALIZER_MAX_SLIDES || limits.maxEdge > PPTX_SLIDE_MATERIALIZER_MAX_EDGE ||
    limits.maxPixels > PPTX_SLIDE_MATERIALIZER_MAX_PIXELS || limits.maxPngBytesPerSlide > PPTX_SLIDE_MATERIALIZER_MAX_PNG_BYTES_PER_SLIDE ||
    limits.maxTotalPngBytes > PPTX_SLIDE_MATERIALIZER_MAX_TOTAL_PNG_BYTES || limits.timeoutMs > PPTX_SLIDE_MATERIALIZER_TIMEOUT_MS) {
    throw materializerError("parser.pptx.materializer_invalid_request", "The PPTX slide materializer limits exceed the frozen safety bounds.");
  }
  return limits;
}

async function readVerifiedSource(filePath: string, expectedChecksum: string, maxBytes: number): Promise<{ readonly checksum: string }> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(filePath);
  } catch {
    throw materializerError("parser.pptx.source_missing", "The preserved PPTX source is unavailable.");
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw materializerError("parser.pptx.source_missing", "The preserved PPTX source is unavailable.");
  if (stat.size > maxBytes) throw materializerError("parser.pptx.file_too_large", "The PPTX exceeds the local materializer size limit.");
  let handle: fs.promises.FileHandle | undefined;
  try {
    handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size) {
      throw materializerError("parser.pptx.source_changed", "The preserved PPTX changed before slide materialization.");
    }
    const bytes = await handle.readFile();
    if (bytes.byteLength !== stat.size || bytes.byteLength > maxBytes) throw materializerError("parser.pptx.source_changed", "The preserved PPTX changed while it was being read.");
    const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (checksum !== expectedChecksum) throw materializerError("parser.pptx.source_changed", "The preserved PPTX no longer matches parser provenance.");
    return { checksum };
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw materializerError("parser.pptx.source_missing", "The preserved PPTX source is unavailable.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function orderedSlideParts(packageData: OpenXmlPackage): string[] {
  const presentation = packageData.entries.get("ppt/presentation.xml");
  const relationships = packageData.entries.get("ppt/_rels/presentation.xml.rels");
  if (!presentation || !relationships) throw materializerError("parser.pptx.required_part_missing", "The PPTX presentation parts are unavailable.");
  const relationById = new Map(parseRelationships(relationships, "ppt/presentation.xml").map((relation) => [relation.id, relation]));
  const ids = findElements(parseXml(presentation), "sldId").map((node) => attribute(node, "r:id") ?? attribute(node, "id"));
  const parts = ids.map((id) => {
    const relation = id ? relationById.get(id) : undefined;
    if (!relation || relation.external || !relation.type.endsWith("/slide")) return undefined;
    return resolveRelationshipTarget("ppt/presentation.xml", relation.target);
  }).filter((part): part is string => Boolean(part));
  if (parts.length === 0) {
    return [...packageData.entryNames].filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name)).sort(compareNumberedPart);
  }
  return Array.from(new Set(parts));
}

function readSlideGeometry(packageData: OpenXmlPackage): SlideGeometry {
  const presentation = packageData.entries.get("ppt/presentation.xml");
  if (!presentation) throw materializerError("parser.pptx.required_part_missing", "The PPTX presentation part is unavailable.");
  const size = findElements(parseXml(presentation), "sldSz")[0];
  const widthEmu = positiveNumber(attribute(size, "cx")) ?? 13.333 * EMU_PER_INCH;
  const heightEmu = positiveNumber(attribute(size, "cy")) ?? 7.5 * EMU_PER_INCH;
  return { widthEmu, heightEmu };
}

function boundedRenderSize(geometry: SlideGeometry, limits: PptxSlideMaterializerLimits): { readonly width: number; readonly height: number; readonly state: RenderState } {
  const ratio = geometry.widthEmu / geometry.heightEmu;
  let width = Math.min(limits.maxEdge, Math.max(1, Math.round(Math.sqrt(limits.maxPixels * ratio))));
  let height = Math.min(limits.maxEdge, Math.max(1, Math.round(width / ratio)));
  if (width * height > limits.maxPixels) {
    const scale = Math.sqrt(limits.maxPixels / (width * height));
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  return {
    width,
    height,
    state: { scaleX: width / geometry.widthEmu, scaleY: height / geometry.heightEmu, offsetX: 0, offsetY: 0 }
  };
}

function collectMediaTargets(packageData: OpenXmlPackage, slideParts: readonly string[], slides: readonly number[]): OfficeMediaTarget[] {
  const references = new Map(packageData.mediaReferences.map((media) => [media.packagePath, media]));
  const targets: OfficeMediaTarget[] = [];
  for (const slide of slides) {
    const part = slideParts[slide - 1];
    if (!part) continue;
    const relsPart = `${path.posix.dirname(part)}/_rels/${path.posix.basename(part)}.rels`;
    const xml = packageData.entries.get(relsPart);
    if (!xml) continue;
    let mediaIndex = 0;
    for (const relation of parseRelationships(xml, part)) {
      if (relation.external || !relation.type.endsWith("/image")) continue;
      const packagePath = resolveRelationshipTarget(part, relation.target);
      const reference = references.get(packagePath);
      if (!reference || !RENDERABLE_MEDIA_EXTENSIONS.has(reference.extension)) continue;
      mediaIndex += 1;
      targets.push({
        slide,
        parentLocator: `slide:${slide}`,
        mediaIndex,
        locator: `slide:${slide}/media:${mediaIndex}`,
        packagePath: reference.packagePath,
        size: reference.size,
        extension: reference.extension
      });
    }
  }
  return targets;
}

async function renderSlide(
  context: SKRSContext2D,
  nodes: readonly OrderedNode[],
  relationships: readonly Relationship[],
  mediaByLocator: ReadonlyMap<string, Uint8Array>,
  renderSize: { readonly width: number; readonly height: number; readonly state: RenderState },
  slide: number
): Promise<string[]> {
  const warnings: string[] = [];
  const state = renderSize.state;
  const shapes = findElements(nodes, "sp");
  if (shapes.length > MAX_SHAPES_PER_SLIDE) {
    throw materializerError("parser.pptx.render_limit", "The PPTX slide contains too many renderable shapes.");
  }
  let textRuns = 0;
  for (const shape of shapes) {
    const transform = shapeTransform(shape, state);
    const geometry = findElements(shapeChildren(shape), "prstGeom")[0];
    const preset = attribute(geometry, "prst");
    const text = normalizeText(textFromNamedElements(shapeChildren(shape), "t"));
    if (text) {
      textRuns += 1;
      if (textRuns > MAX_TEXT_RUNS_PER_SLIDE) throw materializerError("parser.pptx.render_limit", "The PPTX slide contains too much text to materialize.");
      context.save();
      context.fillStyle = "#111111";
      context.font = `${Math.max(10, Math.round(Math.min(transform.width, transform.height) * 0.18))}px sans-serif`;
      context.textBaseline = "top";
      context.fillText(text.slice(0, 10_000), transform.x, transform.y, Math.max(1, transform.width));
      context.restore();
    }
    if (preset === "rect" || preset === "roundRect") {
      context.strokeStyle = "#666666";
      context.strokeRect(transform.x, transform.y, transform.width, transform.height);
    } else if (preset === "ellipse") {
      context.beginPath();
      context.ellipse(transform.x + transform.width / 2, transform.y + transform.height / 2, transform.width / 2, transform.height / 2, 0, 0, Math.PI * 2);
      context.strokeStyle = "#666666";
      context.stroke();
    } else if (preset === "line") {
      context.beginPath();
      context.moveTo(transform.x, transform.y);
      context.lineTo(transform.x + transform.width, transform.y + transform.height);
      context.strokeStyle = "#666666";
      context.stroke();
    } else if (preset && preset !== "rect" && preset !== "ellipse" && preset !== "line" && preset !== "roundRect") {
      warnings.push(`unsupported_shape:${preset}`);
    }
  }

  const pictures = findElements(nodes, "pic");
  for (let index = 0; index < pictures.length; index += 1) {
    const picture = pictures[index];
    if (!picture) continue;
    const embed = findElements(shapeChildren(picture), "blip")[0];
    const relationId = attribute(embed, "r:embed");
    const relation = relationId ? relationships.find((candidate) => candidate.id === relationId) : undefined;
    const target = relation && !relation.external ? relation : undefined;
    const locator = `slide:${slide}/media:${index + 1}`;
    const bytes = mediaByLocator.get(locator);
    if (!target || !bytes) {
      warnings.push(`unsupported_media:${locator}`);
      continue;
    }
    const transform = shapeTransform(picture, state);
    try {
      const image = await loadImage(Buffer.from(bytes));
      // The image is intentionally loaded from the in-memory ZIP part and never a path.
      context.drawImage(image, transform.x, transform.y, transform.width, transform.height);
    } catch {
      warnings.push(`unsupported_media:${locator}`);
    }
  }
  const graphicFrames = findElements(nodes, "graphicFrame");
  if (graphicFrames.length > 0) warnings.push("unsupported_chart_or_graphic");
  return uniqueWarnings(warnings);
}

function shapeTransform(node: OrderedNode, state: RenderState): { readonly x: number; readonly y: number; readonly width: number; readonly height: number } {
  const transform = findElements(shapeChildren(node), "xfrm")[0];
  const offset = transform ? findElements(elementChildren(transform), "off")[0] : undefined;
  const extent = transform ? findElements(elementChildren(transform), "ext")[0] : undefined;
  const x = (positiveNumber(attribute(offset, "x")) ?? 0) * state.scaleX + state.offsetX;
  const y = (positiveNumber(attribute(offset, "y")) ?? 0) * state.scaleY + state.offsetY;
  const width = Math.max(1, (positiveNumber(attribute(extent, "cx")) ?? 100_000) * state.scaleX);
  const height = Math.max(1, (positiveNumber(attribute(extent, "cy")) ?? 60_000) * state.scaleY);
  return { x, y, width, height };
}

function parseRelationships(xml: string, basePart: string): Relationship[] {
  const relationships = findElements(parseXml(xml), "Relationship").map((node) => ({
    id: attribute(node, "Id") ?? "",
    type: attribute(node, "Type") ?? "",
    target: attribute(node, "Target") ?? "",
    external: (attribute(node, "TargetMode") ?? "").toLocaleLowerCase() === "external"
  })).filter((relation) => relation.id && relation.type && relation.target);
  const ids = new Set<string>();
  for (const relation of relationships) {
    if (ids.has(relation.id)) throw materializerError("parser.pptx.duplicate_relationship", "The PPTX contains duplicate relationship IDs.");
    ids.add(relation.id);
    if (!relation.external) resolveRelationshipTarget(basePart, relation.target);
  }
  return relationships;
}

function resolveRelationshipTarget(basePart: string, target: string): string {
  const normalized = target.replaceAll("\\", "/");
  if (/^[a-z][a-z0-9+.-]*:/iu.test(normalized) || normalized.startsWith("//")) {
    throw materializerError("parser.pptx.unsafe_relationship", "The PPTX contains an unsafe relationship.");
  }
  const resolved = normalized.startsWith("/")
    ? path.posix.normalize(normalized.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(basePart), normalized));
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw materializerError("parser.pptx.unsafe_relationship", "The PPTX relationship escapes the package.");
  }
  return resolved;
}

function parseXml(xml: string): OrderedNode[] {
  if (/<!DOCTYPE/iu.test(xml)) throw materializerError("parser.pptx.doctype_not_allowed", "DOCTYPE declarations are not allowed in PPTX input.");
  try {
    const parsed = XML_PARSER.parse(xml, true) as unknown;
    if (!Array.isArray(parsed)) throw new Error("not ordered");
    return parsed.filter(isOrderedNode);
  } catch {
    throw materializerError("parser.pptx.invalid_xml", "The PPTX contains invalid XML.");
  }
}

function findElements(nodes: readonly OrderedNode[], wantedName: string): OrderedNode[] {
  const found: OrderedNode[] = [];
  for (const node of nodes) {
    if (localName(elementName(node)) === wantedName) found.push(node);
    found.push(...findElements(elementChildren(node), wantedName));
  }
  return found;
}

function elementName(node: OrderedNode): string {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text" && key !== "?xml") ?? "";
}

function elementChildren(node: OrderedNode): OrderedNode[] {
  const value = node[elementName(node)];
  return Array.isArray(value) ? value.filter(isOrderedNode) : [];
}

function shapeChildren(node: OrderedNode): OrderedNode[] {
  return elementChildren(node);
}

function localName(value: string): string {
  return value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
}

function attribute(node: OrderedNode | undefined, name: string): string | undefined {
  if (!node) return undefined;
  const attributes = node[":@"]; 
  if (!isRecord(attributes)) return undefined;
  const value = attributes[name];
  return typeof value === "string" ? value : undefined;
}

function rawText(nodes: readonly OrderedNode[]): string {
  let value = "";
  for (const node of nodes) {
    if (typeof node["#text"] === "string") value += node["#text"];
    value += rawText(elementChildren(node));
  }
  return value;
}

function textFromNamedElements(nodes: readonly OrderedNode[], wantedName: string): string {
  let value = "";
  for (const node of nodes) {
    if (localName(elementName(node)) === wantedName) value += rawText(elementChildren(node));
    else value += textFromNamedElements(elementChildren(node), wantedName);
  }
  return value;
}

function normalizeText(value: string): string {
  return value.replaceAll("\u0000", "").replace(/[ \t\r\n]+/gu, " ").trim();
}

function releaseCanvas(canvas: Canvas): void {
  canvas.width = 0;
  canvas.height = 0;
}

function checkDeadline(startedAt: number, timeoutMs: number): void {
  if (Date.now() - startedAt > timeoutMs) throw materializerError("parser.pptx.materializer_timeout", "PPTX slide materialization exceeded the local time limit.");
}

function slideNumber(locator: string): number {
  return Number(locator.slice("slide:".length));
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value || !/^\d+(?:\.\d+)?$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isChecksum(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function compareNumberedPart(left: string, right: string): number {
  const leftNumber = Number(/(\d+)\.xml$/u.exec(left)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const rightNumber = Number(/(\d+)\.xml$/u.exec(right)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return leftNumber - rightNumber || left.localeCompare(right);
}

function uniqueWarnings(values: readonly string[]): string[] {
  return Array.from(new Set(values)).slice(0, 64);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isOrderedNode(value: unknown): value is OrderedNode {
  return isRecord(value);
}

function materializerError(code: string, message: string): PigeDomainError {
  return new PigeDomainError(code, message);
}
