import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { XMLParser } from "fast-xml-parser";
import { convertAnyDocSnapshot, limitConvertedMarkdown } from "./anydoc-converter";
import { readOpenXmlPackage, type OpenXmlPackage } from "./office-archive";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_OCR_EXTENSIONS,
  OFFICE_MEDIA_TARGET_SCHEMA_VERSION,
  OFFICE_PARSER_VERSION,
  type OfficeExtractionResult,
  type OfficeExtractionUnit,
  type OfficeUnitMediaReference,
  type OfficeParserRequest
} from "./office-parser-types";
import type { ParserTextCoverage } from "./parser-artifact-service";

type OrderedNode = Record<string, unknown>;

const PROMPT_INJECTION_PATTERN = /(?:ignore\s+(?:all\s+)?previous|system\s+prompt|reveal\s+(?:the\s+)?(?:api\s+key|secret)|override\s+(?:the\s+)?instructions)/iu;

const xmlParser = new XMLParser({
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

export async function extractOfficeText(request: OfficeParserRequest): Promise<OfficeExtractionResult> {
  validateSourceFile(request);
  const format = request.sourceKind === "docx_file" ? "docx" : "pptx";
  try {
    const packageData = await readOpenXmlPackage(request.filePath, format, request.limits);
    return format === "docx"
      ? await extractDocx(request, packageData)
      : extractPptx(request, packageData);
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError(`parser.${format}.failed`, `${format.toUpperCase()} text extraction failed.`);
  }
}

async function extractDocx(request: OfficeParserRequest, packageData: OpenXmlPackage): Promise<OfficeExtractionResult> {
  requirePart(packageData, "word/document.xml", "docx");
  const relationshipXml = requirePart(packageData, "word/_rels/document.xml.rels", "docx");
  parseRelationships(relationshipXml, "word/document.xml", "docx");
  const converted = await convertAnyDocSnapshot(request.filePath, "docx", request.limits.maxBytes, { includeDocument: true });
  const { text, truncated } = limitConvertedMarkdown(converted.markdown, request.limits.maxTextCharacters);
  const mediaReferences = [...packageData.mediaReferences].sort((left, right) => left.packagePath.localeCompare(right.packagePath));
  const bridgedMedia = mapAnyDocAssetsToMedia(converted.document?.assets ?? [], mediaReferences, "image");
  const units = buildMarkdownUnits(text, bridgedMedia);
  const markdownStats = summarizeMarkdown(text);
  const title = extractCoreTitle(packageData) ?? firstMarkdownHeading(text);
  const ocrCandidateLocators = bridgedMedia.map((media) => media.locator);
  const warnings: string[] = [];
  if (truncated) warnings.push("DOCX text was truncated at the configured extracted-text limit.");
  if (ocrCandidateLocators.length > 0) {
    warnings.push("The DOCX contains embedded images that are waiting for OCR enrichment.");
  }
  if (PROMPT_INJECTION_PATTERN.test(text)) {
    warnings.push("The document contains instruction-like text and remains untrusted source content.");
  }
  const textCoverage = classifyDocxCoverage(text.length);
  if (textCoverage === "none" || textCoverage === "low") {
    warnings.push("The DOCX contains too little readable text for Agent ingest.");
  }

  return {
    parserId: OFFICE_PARSER_ID,
    engine: OFFICE_PARSER_ENGINE,
    engineVersion: OFFICE_PARSER_VERSION,
    format: "docx",
    ...(title ? { title } : {}),
    text,
    textCharacterCount: text.length,
    textCoverage,
    truncated,
    needsOcr: ocrCandidateLocators.length > 0,
    agentTextReady: textCoverage === "medium" || textCoverage === "high",
    ocrCandidateLocators,
    unitCount: units.length,
    processedUnitCount: units.length,
    unitsWithText: units.filter((unit) => unit.characterCount > 0).length,
    units,
    entryCount: packageData.entryCount,
    totalUncompressedBytes: packageData.totalUncompressedBytes,
    mediaReferences,
    structure: {
      mediaTargetSchemaVersion: OFFICE_MEDIA_TARGET_SCHEMA_VERSION,
      headingCount: markdownStats.headingCount,
      paragraphCount: markdownStats.paragraphCount,
      listItemCount: markdownStats.listItemCount,
      tableCount: markdownStats.tableCount,
      linkCount: markdownStats.linkCount,
      imageCount: bridgedMedia.length,
      embeddedMediaCount: mediaReferences.length,
      ocrCandidateMediaCount: bridgedMedia.length,
      ocrMaterializableMediaCount: bridgedMedia.filter((media) => isMaterializableOfficeMedia(media.extension, media.size)).length,
      ocrMaterializableMediaBytes: bridgedMedia
        .filter((media) => isMaterializableOfficeMedia(media.extension, media.size))
        .reduce((total, media) => total + media.size, 0)
    },
    warnings: uniqueWarnings(warnings)
  };
}

async function extractPptx(request: OfficeParserRequest, packageData: OpenXmlPackage): Promise<OfficeExtractionResult> {
  const presentationXml = requirePart(packageData, "ppt/presentation.xml", "pptx");
  const presentationRelsXml = requirePart(packageData, "ppt/_rels/presentation.xml.rels", "pptx");
  const presentationNodes = parseOrderedXml(presentationXml, "pptx");
  const presentationRelations = parseRelationships(presentationRelsXml, "ppt/presentation.xml", "pptx");
  const relationById = new Map(presentationRelations.map((relation) => [relation.id, relation]));
  const warnings: string[] = [];
  let slideParts = findElements(presentationNodes, "sldId")
    .map((node) => attribute(node, "r:id") ?? attribute(node, "id"))
    .map((relationId) => relationId ? relationById.get(relationId) : undefined)
    .filter((relation): relation is OpenXmlRelationship => Boolean(relation && !relation.external && relation.type.endsWith("/slide")))
    .map((relation) => resolveRelationshipTarget("ppt/presentation.xml", relation.target, "pptx"));
  if (slideParts.length === 0) {
    slideParts = [...packageData.entryNames]
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
      .sort(compareNumberedPart);
    warnings.push("Presentation slide order was missing; package slide numbering was used as a fallback.");
  }
  slideParts = Array.from(new Set(slideParts));
  const originalSlideCount = slideParts.length;
  if (originalSlideCount > request.limits.maxSlides) {
    throw new PigeDomainError("parser.pptx.resource_limit", "The PPTX exceeds the configured local slide safety limit.");
  }

  const units: OfficeExtractionUnit[] = [];
  const ocrCandidateLocators: string[] = [];
  let externalRelationshipCount = presentationRelations.filter((relation) => relation.external).length;
  let slidesWithImages = 0;
  let ocrCandidateMediaCount = 0;
  let ocrMaterializableMediaCount = 0;
  let ocrMaterializableMediaBytes = 0;
  const mediaByPath = new Map(packageData.mediaReferences.map((media) => [media.packagePath, media]));
  const slideVisibleText: string[] = [];

  for (let index = 0; index < slideParts.length; index += 1) {
    const slidePart = slideParts[index];
    if (!slidePart) continue;
    const slideXml = packageData.entries.get(slidePart);
    if (!slideXml) {
      warnings.push(`Slide ${index + 1} is missing from the OpenXML package.`);
      continue;
    }
    const slideNodes = parseOrderedXml(slideXml, "pptx");
    const visibleParagraphs = extractParagraphs(slideNodes);
    const slideRelsPart = `${path.posix.dirname(slidePart)}/_rels/${path.posix.basename(slidePart)}.rels`;
    const slideRelations = packageData.entries.has(slideRelsPart)
      ? parseRelationships(requirePart(packageData, slideRelsPart, "pptx"), slidePart, "pptx")
      : [];
    externalRelationshipCount += slideRelations.filter((relation) => relation.external).length;
    const imageRelations = slideRelations.filter((relation) => relation.type.endsWith("/image") && !relation.external);
    const mediaReferences: OfficeUnitMediaReference[] = [];
    const seenMediaPaths = new Set<string>();
    for (const relation of imageRelations) {
      const imagePart = resolveRelationshipTarget(slidePart, relation.target, "pptx");
      const media = mediaByPath.get(imagePart);
      if (!media) {
        warnings.push(`Slide ${index + 1} references a missing embedded image.`);
        continue;
      }
      if (seenMediaPaths.has(imagePart)) continue;
      seenMediaPaths.add(imagePart);
      const mediaIndex = mediaReferences.length + 1;
      mediaReferences.push({
        mediaIndex,
        locator: `slide:${index + 1}/media:${mediaIndex}`,
        packagePath: media.packagePath,
        size: media.size,
        extension: media.extension
      });
    }
    const imageCount = mediaReferences.length;
    if (imageCount > 0) slidesWithImages += 1;
    const visibleText = normalizeParagraphs(visibleParagraphs);
    slideVisibleText.push(visibleText);
    const needsOcr = visibleText.length < 80;
    if (needsOcr) {
      ocrCandidateLocators.push(`slide:${index + 1}`);
      ocrCandidateMediaCount += mediaReferences.length;
      const materializable = mediaReferences.filter((media) => isMaterializableOfficeMedia(media.extension, media.size));
      ocrMaterializableMediaCount += materializable.length;
      ocrMaterializableMediaBytes += materializable.reduce((total, media) => total + media.size, 0);
    }
    units.push({
      index: index + 1,
      locator: `slide:${index + 1}`,
      kind: "slide",
      characterStart: 0,
      characterEnd: 0,
      characterCount: visibleText.length,
      imageCount,
      ...(mediaReferences.length > 0 ? { mediaReferences } : {}),
      needsOcr,
      warnings: needsOcr ? ["Slide has sparse visible text; full-slide OCR may recover rendered content."] : []
    });
  }

  const converted = await convertAnyDocSnapshot(request.filePath, "pptx", request.limits.maxBytes);
  const limited = limitConvertedMarkdown(converted.markdown, request.limits.maxTextCharacters);
  const text = limited.text;
  const textRanges = mapSlideTextRanges(text, slideVisibleText);
  const finalizedUnits = units.map((unit, index) => {
    const range = textRanges[index];
    return range ? { ...unit, ...range } : unit;
  });
  if (externalRelationshipCount > 0) {
    warnings.push(`Ignored ${externalRelationshipCount} external presentation relationship(s); no external target was opened.`);
  }
  if (ocrCandidateLocators.length > 0) {
    warnings.push("Image-heavy or text-sparse slides are waiting for OCR enrichment.");
  }
  if (PROMPT_INJECTION_PATTERN.test(text)) {
    warnings.push("The presentation contains instruction-like text and remains untrusted source content.");
  }
  const unitsWithText = finalizedUnits.filter((unit) => unit.characterCount > 0).length;
  const meaningfulUnits = finalizedUnits.filter((unit) => unit.characterCount >= 32).length;
  const textCoverage = classifyUnitCoverage(finalizedUnits.length, meaningfulUnits, text.length);
  if (textCoverage === "none" || textCoverage === "low") warnings.push("The PPTX contains too little readable text for Agent ingest.");
  if (limited.truncated) warnings.push("Presentation text was truncated at the configured extracted-text limit.");
  const title = extractCoreTitle(packageData, "pptx") ?? firstMarkdownHeading(text);

  return {
    parserId: OFFICE_PARSER_ID,
    engine: OFFICE_PARSER_ENGINE,
    engineVersion: OFFICE_PARSER_VERSION,
    format: "pptx",
    ...(title ? { title } : {}),
    text,
    textCharacterCount: text.length,
    textCoverage,
    truncated: limited.truncated,
    needsOcr: ocrCandidateLocators.length > 0,
    agentTextReady: textCoverage === "medium" || textCoverage === "high",
    ocrCandidateLocators,
    unitCount: originalSlideCount,
    processedUnitCount: finalizedUnits.length,
    unitsWithText,
    units: finalizedUnits,
    entryCount: packageData.entryCount,
    totalUncompressedBytes: packageData.totalUncompressedBytes,
    mediaReferences: [...packageData.mediaReferences].sort((left, right) => left.packagePath.localeCompare(right.packagePath)),
    structure: {
      mediaTargetSchemaVersion: OFFICE_MEDIA_TARGET_SCHEMA_VERSION,
      slideCount: originalSlideCount,
      processedSlideCount: finalizedUnits.length,
      slidesWithImages,
      imageCount: packageData.mediaReferences.length,
      ocrCandidateSlideCount: ocrCandidateLocators.length,
      ocrCandidateMediaCount,
      ocrMaterializableMediaCount,
      ocrMaterializableMediaBytes,
      externalRelationshipCount
    },
    warnings: uniqueWarnings(warnings)
  };
}

function isMaterializableOfficeMedia(extension: string, size: number): boolean {
  return size > 0 && size <= OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM &&
    OFFICE_MEDIA_OCR_EXTENSIONS.includes(extension as typeof OFFICE_MEDIA_OCR_EXTENSIONS[number]);
}

function mapAnyDocAssetsToMedia(
  assets: readonly { readonly originPart: string }[],
  media: readonly { readonly packagePath: string; readonly size: number; readonly extension: string }[],
  locatorPrefix: "image"
): OfficeUnitMediaReference[] {
  const byPackagePath = new Map(media.map((entry) => [entry.packagePath, entry]));
  const resolved: OfficeUnitMediaReference[] = [];
  for (const asset of assets) {
    const originPart = asset.originPart.replaceAll("\\", "/").replace(/^\/+/, "");
    const entry = byPackagePath.get(originPart);
    if (!entry || resolved.some((candidate) => candidate.packagePath === entry.packagePath)) continue;
    const mediaIndex = resolved.length + 1;
    resolved.push({
      mediaIndex,
      locator: `${locatorPrefix}:${mediaIndex}`,
      packagePath: entry.packagePath,
      size: entry.size,
      extension: entry.extension
    });
  }
  return resolved;
}

function buildMarkdownUnits(text: string, media: readonly OfficeUnitMediaReference[]): OfficeExtractionUnit[] {
  const parts = text.split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  let searchStart = 0;
  const units = parts.map((part, index) => {
    const foundAt = text.indexOf(part, searchStart);
    const characterStart = foundAt >= 0 ? foundAt : searchStart;
    searchStart = Math.min(text.length, characterStart + part.length);
    const kind = part.startsWith("#")
      ? "heading"
      : /^(?:[-*+] |\d+\. )/u.test(part)
        ? "list_item"
        : part.includes("|") && part.includes("\n")
          ? "table"
          : "paragraph";
    return {
      index: index + 1,
      locator: `block:${index + 1}`,
      kind,
      characterStart: Math.max(0, characterStart),
      characterEnd: Math.max(0, characterStart) + part.length,
      characterCount: part.length,
      imageCount: 0,
      needsOcr: false,
      warnings: []
    } satisfies OfficeExtractionUnit;
  });
  if (media.length === 0) return units;
  const target = units[0] ?? {
    index: 1,
    locator: "block:1",
    kind: "paragraph" as const,
    characterStart: 0,
    characterEnd: 0,
    characterCount: 0,
    imageCount: 0,
    needsOcr: false,
    warnings: []
  };
  const bridgedTarget: OfficeExtractionUnit = {
    ...target,
    imageCount: media.length,
    mediaReferences: media,
    needsOcr: true,
    warnings: ["Block contains embedded document assets that may need OCR."]
  };
  return units.length > 0 ? [bridgedTarget, ...units.slice(1)] : [bridgedTarget];
}

function summarizeMarkdown(text: string): {
  readonly headingCount: number;
  readonly paragraphCount: number;
  readonly listItemCount: number;
  readonly tableCount: number;
  readonly linkCount: number;
} {
  const blocks = text.split(/\n{2,}/u).map((value) => value.trim()).filter(Boolean);
  return {
    headingCount: blocks.filter((block) => /^#{1,6}\s/u.test(block)).length,
    paragraphCount: blocks.filter((block) => !/^#{1,6}\s/u.test(block) && !/^(?:[-*+] |\d+\. )/u.test(block) && !block.includes("|\n")).length,
    listItemCount: text.split("\n").filter((line) => /^(?:[-*+] |\d+\. )/u.test(line)).length,
    tableCount: blocks.filter((block) => block.includes("|\n")).length,
    linkCount: (text.match(/\[[^\]]+\]\(https?:\/\//gu) ?? []).length
  };
}

function firstMarkdownHeading(text: string): string | undefined {
  const heading = /^#{1,6}\s+(.+)$/mu.exec(text)?.[1];
  return heading ? trimTitle(heading) : undefined;
}

function mapSlideTextRanges(text: string, slideTexts: readonly string[]): Array<Pick<OfficeExtractionUnit, "characterStart" | "characterEnd"> | undefined> {
  let searchStart = 0;
  return slideTexts.map((slideText) => {
    if (!slideText) return undefined;
    const index = text.indexOf(slideText, searchStart);
    if (index < 0) return undefined;
    searchStart = index + slideText.length;
    return { characterStart: index, characterEnd: searchStart };
  });
}

interface OpenXmlRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function parseRelationships(xml: string, basePart: string, format: "docx" | "pptx"): OpenXmlRelationship[] {
  const relationships = findElements(parseOrderedXml(xml, format), "Relationship").map((node) => ({
    id: attribute(node, "Id") ?? "",
    type: attribute(node, "Type") ?? "",
    target: attribute(node, "Target") ?? "",
    external: (attribute(node, "TargetMode") ?? "").toLocaleLowerCase() === "external"
  })).filter((relation) => relation.id && relation.type && relation.target);
  const relationIds = new Set<string>();
  return relationships.map((relation) => {
    if (relationIds.has(relation.id)) {
      throw new PigeDomainError(`parser.${format}.duplicate_relationship`, `The ${format.toUpperCase()} package contains duplicate relationship IDs.`);
    }
    relationIds.add(relation.id);
    if (!relation.external) resolveRelationshipTarget(basePart, relation.target, format);
    return relation;
  });
}

function resolveRelationshipTarget(basePart: string, target: string, format: "docx" | "pptx"): string {
  const normalizedTarget = target.replaceAll("\\", "/");
  if (/^[a-z][a-z0-9+.-]*:/iu.test(normalizedTarget) || normalizedTarget.startsWith("//")) {
    throw new PigeDomainError(`parser.${format}.unsafe_relationship`, `The ${format.toUpperCase()} package contains an unsafe internal relationship.`);
  }
  const resolved = normalizedTarget.startsWith("/")
    ? path.posix.normalize(normalizedTarget.slice(1))
    : path.posix.normalize(path.posix.join(path.posix.dirname(basePart), normalizedTarget));
  if (!resolved || resolved === "." || resolved === ".." || resolved.startsWith("../") || path.posix.isAbsolute(resolved)) {
    throw new PigeDomainError(`parser.${format}.unsafe_relationship`, `The ${format.toUpperCase()} relationship escapes the package.`);
  }
  return resolved;
}

function parseOrderedXml(xml: string, format: "docx" | "pptx"): OrderedNode[] {
  if (/<!DOCTYPE/iu.test(xml)) {
    throw new PigeDomainError(`parser.${format}.doctype_not_allowed`, `DOCTYPE declarations are not allowed in ${format.toUpperCase()} parser input.`);
  }
  let parsed: unknown;
  try {
    parsed = xmlParser.parse(xml, true) as unknown;
  } catch {
    throw new PigeDomainError(`parser.${format}.invalid_xml`, `The ${format.toUpperCase()} package contains invalid XML.`);
  }
  if (!Array.isArray(parsed)) throw new PigeDomainError(`parser.${format}.invalid_xml`, `The ${format.toUpperCase()} package contains invalid XML.`);
  return parsed.filter(isOrderedNode);
}

function extractCoreTitle(packageData: OpenXmlPackage, format: "docx" | "pptx" = "docx"): string | undefined {
  const coreXml = packageData.entries.get("docProps/core.xml");
  if (!coreXml) return undefined;
  const titleNode = findElements(parseOrderedXml(coreXml, format), "title")[0];
  return titleNode ? trimTitle(rawText(elementChildren(titleNode))) : undefined;
}

function extractParagraphs(nodes: readonly OrderedNode[]): string[] {
  return findElements(nodes, "p")
    .map((paragraph) => normalizeInline(textFromNamedElements(elementChildren(paragraph), "t")))
    .filter(Boolean);
}

function textFromNamedElements(nodes: readonly OrderedNode[], wantedName: string): string {
  let value = "";
  for (const node of nodes) {
    if (localName(elementName(node)) === wantedName) value += rawText(elementChildren(node));
    else value += textFromNamedElements(elementChildren(node), wantedName);
  }
  return value;
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

function localName(value: string): string {
  return value.includes(":") ? value.slice(value.lastIndexOf(":") + 1) : value;
}

function elementChildren(node: OrderedNode): OrderedNode[] {
  const value = node[elementName(node)];
  return Array.isArray(value) ? value.filter(isOrderedNode) : [];
}

function attribute(node: OrderedNode, name: string): string | undefined {
  const attributes = node[":@"];
  if (typeof attributes !== "object" || attributes === null) return undefined;
  const value = (attributes as Record<string, unknown>)[name];
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

function isOrderedNode(value: unknown): value is OrderedNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requirePart(packageData: OpenXmlPackage, part: string, format: "docx" | "pptx"): string {
  const value = packageData.entries.get(part);
  if (value === undefined) throw new PigeDomainError(`parser.${format}.required_part_missing`, `The ${format.toUpperCase()} package is missing a required OpenXML part.`);
  return value;
}

function normalizeInline(value: string): string {
  return value
    .replaceAll("\u0000", "")
    .replace(/[ \t]+/gu, " ")
    .replace(/ *\n */gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function normalizeParagraphs(values: readonly string[]): string {
  return values.map(normalizeInline).filter(Boolean).join("\n");
}

function classifyDocxCoverage(characterCount: number): ParserTextCoverage {
  if (characterCount === 0) return "none";
  if (characterCount < 32) return "low";
  if (characterCount < 500) return "medium";
  return "high";
}

function classifyUnitCoverage(unitCount: number, meaningfulUnits: number, characterCount: number): ParserTextCoverage {
  if (unitCount === 0 || characterCount === 0) return "none";
  const ratio = meaningfulUnits / unitCount;
  if (ratio >= 0.8) return "high";
  if (ratio >= 0.4 || characterCount >= 500) return "medium";
  return "low";
}

function trimTitle(value: string): string | undefined {
  const normalized = normalizeInline(value).replace(/[\u0000-\u001f\u007f]+/gu, " ").trim();
  return normalized ? normalized.slice(0, 240) : undefined;
}

function compareNumberedPart(left: string, right: string): number {
  const leftNumber = Number(/(\d+)\.xml$/u.exec(left)?.[1] ?? Number.MAX_SAFE_INTEGER);
  const rightNumber = Number(/(\d+)\.xml$/u.exec(right)?.[1] ?? Number.MAX_SAFE_INTEGER);
  return leftNumber - rightNumber || left.localeCompare(right);
}

function uniqueWarnings(warnings: readonly string[]): string[] {
  return Array.from(new Set(warnings.map((warning) => warning.replace(/\s+/gu, " ").trim()).filter(Boolean))).slice(0, 64);
}

function validateSourceFile(request: OfficeParserRequest): void {
  try {
    const stat = fs.lstatSync(request.filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("not regular file");
    if (stat.size > request.limits.maxBytes) {
      const format = request.sourceKind === "docx_file" ? "DOCX" : "PPTX";
      throw new PigeDomainError(`parser.${format.toLocaleLowerCase()}.file_too_large`, `The ${format} exceeds the configured local parser size limit.`);
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("parser.office.source_missing", "The preserved Office source is unavailable.");
  }
}
