import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { XMLParser } from "fast-xml-parser";
import mammoth from "mammoth";
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
const SENSITIVE_QUERY_KEY_PATTERN = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|code|credential|key|password|secret|signature|sig|token)(?:$|[_-])/iu;

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
  let imageIndex = 0;
  let converted;
  try {
    converted = await mammoth.convertToHtml({ path: request.filePath }, {
      includeEmbeddedStyleMap: false,
      includeDefaultStyleMap: true,
      externalFileAccess: false,
      ignoreEmptyParagraphs: true,
      idPrefix: "pige-docx-",
      convertImage: mammoth.images.imgElement(async () => ({ src: `pige-image:${++imageIndex}` }))
    });
  } catch {
    throw new PigeDomainError("parser.docx.invalid", "The DOCX document could not be converted safely.");
  }

  const renderer = new DocxHtmlRenderer(request.limits.maxTextCharacters);
  let orderedHtml: OrderedNode[];
  try {
    orderedHtml = parseOrderedXml(`<pige-root>${converted.value}</pige-root>`, "docx");
  } catch {
    throw new PigeDomainError("parser.docx.invalid_output", "The DOCX converter returned invalid structured output.");
  }
  renderer.render(orderedHtml);
  const title = extractCoreTitle(packageData) ?? renderer.firstHeading;
  const mediaReferences = [...packageData.mediaReferences].sort((left, right) => left.packagePath.localeCompare(right.packagePath));
  const ocrCandidateLocators = renderer.imageLocators;
  const warnings = renderer.warnings;
  if (converted.messages.length > 0) {
    warnings.push(`The DOCX converter reported ${converted.messages.length} recoverable issue(s).`);
  }
  if (ocrCandidateLocators.length > 0) {
    warnings.push("The DOCX contains embedded images that are waiting for OCR enrichment.");
  }
  if (PROMPT_INJECTION_PATTERN.test(renderer.text)) {
    warnings.push("The document contains instruction-like text and remains untrusted source content.");
  }
  const textCoverage = classifyDocxCoverage(renderer.text.length);
  if (textCoverage === "none" || textCoverage === "low") {
    warnings.push("The DOCX contains too little readable text for Agent ingest.");
  }

  return {
    parserId: OFFICE_PARSER_ID,
    engine: OFFICE_PARSER_ENGINE,
    engineVersion: OFFICE_PARSER_VERSION,
    format: "docx",
    ...(title ? { title } : {}),
    text: renderer.text,
    textCharacterCount: renderer.text.length,
    textCoverage,
    truncated: renderer.truncated,
    needsOcr: ocrCandidateLocators.length > 0,
    agentTextReady: textCoverage === "medium" || textCoverage === "high",
    ocrCandidateLocators,
    unitCount: renderer.units.length,
    processedUnitCount: renderer.units.length,
    unitsWithText: renderer.units.filter((unit) => unit.characterCount > 0).length,
    units: renderer.units,
    entryCount: packageData.entryCount,
    totalUncompressedBytes: packageData.totalUncompressedBytes,
    mediaReferences,
    structure: {
      headingCount: renderer.headingCount,
      paragraphCount: renderer.paragraphCount,
      listItemCount: renderer.listItemCount,
      tableCount: renderer.tableCount,
      linkCount: renderer.linkCount,
      imageCount: ocrCandidateLocators.length,
      embeddedMediaCount: mediaReferences.length
    },
    warnings: uniqueWarnings(warnings)
  };
}

function extractPptx(request: OfficeParserRequest, packageData: OpenXmlPackage): OfficeExtractionResult {
  const presentationXml = requirePart(packageData, "ppt/presentation.xml", "pptx");
  const presentationRelsXml = requirePart(packageData, "ppt/_rels/presentation.xml.rels", "pptx");
  const presentationNodes = parseOrderedXml(presentationXml, "pptx");
  const presentationRelations = parseRelationships(presentationRelsXml, "ppt/presentation.xml");
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
  const limitedSlideParts = slideParts.slice(0, request.limits.maxSlides);
  let truncated = originalSlideCount > limitedSlideParts.length;
  if (truncated) warnings.push(`Only the first ${request.limits.maxSlides} slides were processed because the presentation exceeds the slide limit.`);

  const outputParts: string[] = [];
  const units: OfficeExtractionUnit[] = [];
  const ocrCandidateLocators: string[] = [];
  let firstSlideTitle: string | undefined;
  let externalRelationshipCount = presentationRelations.filter((relation) => relation.external).length;
  let slidesWithNotes = 0;
  let slidesWithImages = 0;
  let outputLength = 0;
  let ocrCandidateMediaCount = 0;
  let ocrMaterializableMediaCount = 0;
  let ocrMaterializableMediaBytes = 0;
  const mediaByPath = new Map(packageData.mediaReferences.map((media) => [media.packagePath, media]));

  for (let index = 0; index < limitedSlideParts.length; index += 1) {
    const slidePart = limitedSlideParts[index];
    if (!slidePart) continue;
    const slideXml = packageData.entries.get(slidePart);
    if (!slideXml) {
      warnings.push(`Slide ${index + 1} is missing from the OpenXML package.`);
      continue;
    }
    const slideNodes = parseOrderedXml(slideXml, "pptx");
    const visibleParagraphs = extractParagraphs(slideNodes);
    if (!firstSlideTitle) firstSlideTitle = visibleParagraphs.find(Boolean);
    const slideRelsPart = `${path.posix.dirname(slidePart)}/_rels/${path.posix.basename(slidePart)}.rels`;
    const slideRelations = packageData.entries.has(slideRelsPart)
      ? parseRelationships(requirePart(packageData, slideRelsPart, "pptx"), slidePart)
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
    const notesRelation = slideRelations.find((relation) => relation.type.endsWith("/notesSlide") && !relation.external);
    const notesPart = notesRelation ? resolveRelationshipTarget(slidePart, notesRelation.target, "pptx") : undefined;
    const noteParagraphs = notesPart && packageData.entries.has(notesPart)
      ? extractParagraphs(parseOrderedXml(requirePart(packageData, notesPart, "pptx"), "pptx"))
      : [];
    if (noteParagraphs.length > 0) slidesWithNotes += 1;
    const visibleText = normalizeParagraphs(visibleParagraphs);
    const notesText = normalizeParagraphs(noteParagraphs);
    const needsOcr = imageCount > 0 && visibleText.length < 80;
    if (needsOcr) {
      ocrCandidateLocators.push(`slide:${index + 1}`);
      ocrCandidateMediaCount += mediaReferences.length;
      const materializable = mediaReferences.filter((media) => isMaterializableOfficeMedia(media.extension, media.size));
      ocrMaterializableMediaCount += materializable.length;
      ocrMaterializableMediaBytes += materializable.reduce((total, media) => total + media.size, 0);
    }
    const slideBody = [
      `--- Slide ${index + 1} ---`,
      visibleText || "[No embedded slide text]",
      notesText ? `Speaker notes:\n${notesText}` : "",
      imageCount > 0 ? `[Image references: ${imageCount}]` : ""
    ].filter(Boolean).join("\n\n");
    const separatorLength = outputParts.length > 0 ? 2 : 0;
    const characterStart = outputLength + separatorLength;
    if (characterStart + slideBody.length > request.limits.maxTextCharacters) {
      truncated = true;
      warnings.push("Presentation text was truncated at the configured extracted-text limit.");
      break;
    }
    outputParts.push(slideBody);
    outputLength = characterStart + slideBody.length;
    units.push({
      index: index + 1,
      locator: `slide:${index + 1}`,
      kind: "slide",
      characterStart,
      characterEnd: characterStart + slideBody.length,
      characterCount: visibleText.length + notesText.length,
      imageCount,
      ...(notesText ? { notesCharacterCount: notesText.length } : {}),
      ...(mediaReferences.length > 0 ? { mediaReferences } : {}),
      needsOcr,
      warnings: needsOcr ? ["Slide has sparse text and image references; OCR may recover visible content."] : []
    });
  }

  const text = outputParts.join("\n\n");
  if (externalRelationshipCount > 0) {
    warnings.push(`Ignored ${externalRelationshipCount} external presentation relationship(s); no external target was opened.`);
  }
  if (ocrCandidateLocators.length > 0) {
    warnings.push("Image-heavy or text-sparse slides are waiting for OCR enrichment.");
  }
  if (PROMPT_INJECTION_PATTERN.test(text)) {
    warnings.push("The presentation contains instruction-like text and remains untrusted source content.");
  }
  const unitsWithText = units.filter((unit) => unit.characterCount > 0).length;
  const meaningfulUnits = units.filter((unit) => unit.characterCount >= 32).length;
  const textCoverage = classifyUnitCoverage(units.length, meaningfulUnits, text.length);
  if (textCoverage === "none" || textCoverage === "low") warnings.push("The PPTX contains too little readable text for Agent ingest.");
  const title = extractCoreTitle(packageData, "pptx") ?? firstSlideTitle;

  return {
    parserId: OFFICE_PARSER_ID,
    engine: OFFICE_PARSER_ENGINE,
    engineVersion: OFFICE_PARSER_VERSION,
    format: "pptx",
    ...(title ? { title } : {}),
    text,
    textCharacterCount: text.length,
    textCoverage,
    truncated,
    needsOcr: ocrCandidateLocators.length > 0,
    agentTextReady: textCoverage === "medium" || textCoverage === "high",
    ocrCandidateLocators,
    unitCount: originalSlideCount,
    processedUnitCount: units.length,
    unitsWithText,
    units,
    entryCount: packageData.entryCount,
    totalUncompressedBytes: packageData.totalUncompressedBytes,
    mediaReferences: [...packageData.mediaReferences].sort((left, right) => left.packagePath.localeCompare(right.packagePath)),
    structure: {
      mediaTargetSchemaVersion: OFFICE_MEDIA_TARGET_SCHEMA_VERSION,
      slideCount: originalSlideCount,
      processedSlideCount: units.length,
      slidesWithNotes,
      slidesWithImages,
      imageCount: packageData.mediaReferences.length,
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

class DocxHtmlRenderer {
  readonly units: OfficeExtractionUnit[] = [];
  readonly warnings: string[] = [];
  readonly imageLocators: string[] = [];
  readonly #maxCharacters: number;
  readonly #parts: string[] = [];
  headingCount = 0;
  paragraphCount = 0;
  listItemCount = 0;
  tableCount = 0;
  linkCount = 0;
  truncated = false;
  firstHeading: string | undefined;

  constructor(maxCharacters: number) {
    this.#maxCharacters = maxCharacters;
  }

  get text(): string {
    return this.#parts.join("\n\n");
  }

  render(nodes: readonly OrderedNode[]): void {
    const root = findElements(nodes, "pige-root")[0];
    this.#renderBlockNodes(root ? elementChildren(root) : nodes);
  }

  #renderBlockNodes(nodes: readonly OrderedNode[]): void {
    for (const node of nodes) {
      if (this.truncated) return;
      const name = localName(elementName(node));
      if (/^h[1-6]$/u.test(name)) {
        const level = Number(name.slice(1));
        const text = this.#renderInline(elementChildren(node), { links: 0, images: 0 });
        if (text) {
          this.headingCount += 1;
          this.firstHeading ??= text;
          this.#appendBlock(`${"#".repeat(level)} ${text}`, "heading", 0);
        }
        continue;
      }
      if (name === "p") {
        const state = { links: 0, images: 0 };
        const text = this.#renderInline(elementChildren(node), state);
        this.linkCount += state.links;
        if (text) {
          this.paragraphCount += 1;
          this.#appendBlock(text, "paragraph", state.images);
        }
        continue;
      }
      if (name === "ul" || name === "ol") {
        this.#renderList(node, name === "ol");
        continue;
      }
      if (name === "table") {
        this.#renderTable(node);
        continue;
      }
      this.#renderBlockNodes(elementChildren(node));
    }
  }

  #renderList(node: OrderedNode, ordered: boolean): void {
    const items = directElements(elementChildren(node), "li");
    items.forEach((item, index) => {
      const state = { links: 0, images: 0 };
      const text = this.#renderInline(elementChildren(item), state);
      this.linkCount += state.links;
      if (!text) return;
      this.listItemCount += 1;
      this.#appendBlock(`${ordered ? `${index + 1}.` : "-"} ${text}`, "list_item", state.images);
    });
  }

  #renderTable(node: OrderedNode): void {
    const rows = findElements(elementChildren(node), "tr")
      .map((row, rowIndex) => {
        const cells = directElements(elementChildren(row), "th", "td")
          .map((cell) => normalizeInline(rawText(elementChildren(cell))))
          .filter(Boolean);
        return cells.length > 0 ? `Table row ${rowIndex + 1}: ${cells.join(" | ")}` : "";
      })
      .filter(Boolean);
    if (rows.length === 0) return;
    this.tableCount += 1;
    this.#appendBlock(rows.join("\n"), "table", 0);
  }

  #renderInline(nodes: readonly OrderedNode[], state: { links: number; images: number }): string {
    let value = "";
    for (const node of nodes) {
      if (typeof node["#text"] === "string") {
        value += node["#text"];
        continue;
      }
      const name = localName(elementName(node));
      if (name === "br") {
        value += "\n";
        continue;
      }
      if (name === "img") {
        state.images += 1;
        const alt = attribute(node, "alt");
        const source = attribute(node, "src");
        const imageNumber = /^pige-image:(\d+)$/u.exec(source ?? "")?.[1] ?? String(this.imageLocators.length + 1);
        const locator = `image:${imageNumber}`;
        if (!this.imageLocators.includes(locator)) this.imageLocators.push(locator);
        value += `[Image${alt ? `: ${normalizeInline(alt)}` : ` ${imageNumber}`}]`;
        continue;
      }
      if (name === "a") {
        state.links += 1;
        const label = this.#renderInline(elementChildren(node), state);
        const target = safeLinkTarget(attribute(node, "href"));
        value += target ? `${label || "Link"} (${target})` : label;
        continue;
      }
      value += this.#renderInline(elementChildren(node), state);
    }
    return normalizeInline(value);
  }

  #appendBlock(value: string, kind: OfficeExtractionUnit["kind"], imageCount: number): void {
    const separatorLength = this.#parts.length > 0 ? 2 : 0;
    const start = this.text.length + separatorLength;
    if (start + value.length > this.#maxCharacters) {
      this.truncated = true;
      this.warnings.push("DOCX text was truncated at the configured extracted-text limit.");
      return;
    }
    this.#parts.push(value);
    this.units.push({
      index: this.units.length + 1,
      locator: `block:${this.units.length + 1}`,
      kind,
      characterStart: start,
      characterEnd: start + value.length,
      characterCount: value.length,
      imageCount,
      needsOcr: imageCount > 0,
      warnings: imageCount > 0 ? ["Block contains an image reference that may need OCR."] : []
    });
  }
}

interface OpenXmlRelationship {
  readonly id: string;
  readonly type: string;
  readonly target: string;
  readonly external: boolean;
}

function parseRelationships(xml: string, basePart: string): OpenXmlRelationship[] {
  const relationships = findElements(parseOrderedXml(xml, "pptx"), "Relationship").map((node) => ({
    id: attribute(node, "Id") ?? "",
    type: attribute(node, "Type") ?? "",
    target: attribute(node, "Target") ?? "",
    external: (attribute(node, "TargetMode") ?? "").toLocaleLowerCase() === "external"
  })).filter((relation) => relation.id && relation.type && relation.target);
  const relationIds = new Set<string>();
  return relationships.map((relation) => {
    if (relationIds.has(relation.id)) {
      throw new PigeDomainError("parser.pptx.duplicate_relationship", "The PPTX package contains duplicate relationship IDs.");
    }
    relationIds.add(relation.id);
    if (!relation.external) resolveRelationshipTarget(basePart, relation.target, "pptx");
    return relation;
  });
}

function resolveRelationshipTarget(basePart: string, target: string, format: "pptx"): string {
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

function directElements(nodes: readonly OrderedNode[], ...wantedNames: string[]): OrderedNode[] {
  const wanted = new Set(wantedNames);
  return nodes.filter((node) => wanted.has(localName(elementName(node))));
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

function safeLinkTarget(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value.startsWith("#")) return value.slice(0, 240);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "mailto:") return undefined;
  parsed.username = "";
  parsed.password = "";
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEY_PATTERN.test(key)) parsed.searchParams.set(key, "[redacted]");
  }
  return parsed.toString().slice(0, 2_000);
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
    const stat = fs.statSync(request.filePath);
    if (!stat.isFile()) throw new Error("not file");
    if (stat.size > request.limits.maxBytes) {
      const format = request.sourceKind === "docx_file" ? "DOCX" : "PPTX";
      throw new PigeDomainError(`parser.${format.toLocaleLowerCase()}.file_too_large`, `The ${format} exceeds the configured local parser size limit.`);
    }
  } catch (caught) {
    if (caught instanceof PigeDomainError) throw caught;
    throw new PigeDomainError("parser.office.source_missing", "The preserved Office source is unavailable.");
  }
}
