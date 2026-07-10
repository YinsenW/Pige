import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { extractOfficeText } from "../../apps/desktop/src/main/services/office-parser-core";
import {
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  type OfficeParserLimits
} from "../../apps/desktop/src/main/services/office-parser-types";
import {
  createOpenXmlZip,
  createTestDocx,
  createTestPptx,
  docxRequiredEntries,
  pptxRequiredEntries
} from "./helpers/office-fixture";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Office parser core", () => {
  it("extracts DOCX headings, paragraphs, lists, tables, safe links, and image references", async () => {
    const filePath = await writeFixture("knowledge.docx", await createTestDocx());

    const result = await extractOfficeText({
      requestId: "docx-semantic",
      filePath,
      sourceKind: "docx_file",
      limits: parserLimits()
    });

    expect(result).toMatchObject({
      format: "docx",
      title: "DOCX Knowledge",
      textCoverage: "medium",
      needsOcr: true,
      agentTextReady: true,
      structure: {
        headingCount: 1,
        paragraphCount: 2,
        listItemCount: 1,
        tableCount: 1,
        linkCount: 1,
        imageCount: 1
      }
    });
    expect(result.text).toContain("# Local knowledge architecture");
    expect(result.text).toContain("- Capture locally before enrichment");
    expect(result.text).toContain("Table row 1: Owner | Local Agent");
    expect(result.text).toContain("reference link (https://example.com/reference?token=%5Bredacted%5D)");
    expect(result.text).toContain("[Image: Architecture diagram]");
    expect(result.text).not.toContain("fixture-secret");
    expect(result.ocrCandidateLocators).toEqual(["image:1"]);
    expect(result.units.map((unit) => unit.locator)).toEqual([
      "block:1",
      "block:2",
      "block:3",
      "block:4",
      "block:5"
    ]);
  });

  it("uses presentation relationship order and preserves notes without opening external targets", async () => {
    const filePath = await writeFixture("roadmap.pptx", await createTestPptx());

    const result = await extractOfficeText({
      requestId: "pptx-semantic",
      filePath,
      sourceKind: "pptx_file",
      limits: parserLimits()
    });

    expect(result).toMatchObject({
      format: "pptx",
      title: "PPTX Knowledge",
      unitCount: 2,
      processedUnitCount: 2,
      needsOcr: true,
      structure: {
        slideCount: 2,
        slidesWithNotes: 1,
        slidesWithImages: 1,
        imageCount: 1,
        externalRelationshipCount: 1
      }
    });
    expect(result.text.indexOf("Roadmap first")).toBeLessThan(result.text.indexOf("Second in presentation order"));
    expect(result.text).toContain("Speaker notes:\nSpeaker note: verify the local-first release gate.");
    expect(result.text).toContain("[Image references: 1]");
    expect(result.text).not.toContain("fixture-secret");
    expect(result.ocrCandidateLocators).toEqual(["slide:1"]);
    expect(result.units.map((unit) => unit.locator)).toEqual(["slide:1", "slide:2"]);
    expect(result.warnings.join(" ")).toContain("Ignored 1 external presentation relationship");
  });

  it("truncates a presentation by the configured slide bound", async () => {
    const filePath = await writeFixture("bounded.pptx", await createTestPptx());

    const result = await extractOfficeText({
      requestId: "pptx-bounded",
      filePath,
      sourceKind: "pptx_file",
      limits: parserLimits({ maxSlides: 1 })
    });

    expect(result.truncated).toBe(true);
    expect(result.unitCount).toBe(2);
    expect(result.processedUnitCount).toBe(1);
    expect(result.text).toContain("Roadmap first");
    expect(result.text).not.toContain("Second in presentation order");
  });

  it("rejects DOCTYPE declarations before a DOCX converter sees them", async () => {
    const documentXml = `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY x "unsafe">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>&x;</w:t></w:r></w:p></w:body></w:document>`;
    const filePath = await writeFixture("doctype.docx", await createOpenXmlZip(docxRequiredEntries(documentXml)));

    await expect(extractOfficeText({
      requestId: "docx-doctype",
      filePath,
      sourceKind: "docx_file",
      limits: parserLimits()
    })).rejects.toMatchObject({ code: "parser.docx.doctype_not_allowed" });
  });

  it("preflights secondary DOCX XML parts before Mammoth follows relationships", async () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
    const unsafeStyles = `<?xml version="1.0"?><!DOCTYPE w:styles [<!ENTITY x "unsafe">]><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="&x;"/></w:styles>`;
    const filePath = await writeFixture("secondary-doctype.docx", await createOpenXmlZip([
      ...docxRequiredEntries(documentXml),
      { name: "word/styles.xml", data: unsafeStyles }
    ]));

    await expect(extractOfficeText({
      requestId: "docx-secondary-doctype",
      filePath,
      sourceKind: "docx_file",
      limits: parserLimits()
    })).rejects.toMatchObject({ code: "parser.docx.doctype_not_allowed" });
  });

  it("rejects unsafe internal PPTX relationship traversal", async () => {
    const relationships = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../../../../outside.xml"/></Relationships>`;
    const filePath = await writeFixture("traversal.pptx", await createOpenXmlZip(pptxRequiredEntries({
      presentationRelationshipsXml: relationships
    })));

    await expect(extractOfficeText({
      requestId: "pptx-traversal",
      filePath,
      sourceKind: "pptx_file",
      limits: parserLimits()
    })).rejects.toMatchObject({ code: "parser.pptx.unsafe_relationship" });
  });

  it("rejects duplicate PPTX relationship IDs", async () => {
    const relationships = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`;
    const filePath = await writeFixture("duplicate-relationship.pptx", await createOpenXmlZip(pptxRequiredEntries({
      presentationRelationshipsXml: relationships
    })));

    await expect(extractOfficeText({
      requestId: "pptx-duplicate-relationship",
      filePath,
      sourceKind: "pptx_file",
      limits: parserLimits()
    })).rejects.toMatchObject({ code: "parser.pptx.duplicate_relationship" });
  });

  it("rejects malformed or excessively nested PPTX XML", async () => {
    const nested = Array.from({ length: 110 }, (_value, index) => `<x:n${index}>`).join("");
    const closing = Array.from({ length: 110 }, (_value, index) => `</x:n${109 - index}>`).join("");
    const presentationXml = `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:x="urn:pige:test">${nested}${closing}</p:presentation>`;
    const filePath = await writeFixture("nested.pptx", await createOpenXmlZip(pptxRequiredEntries({ presentationXml })));

    await expect(extractOfficeText({
      requestId: "pptx-nested",
      filePath,
      sourceKind: "pptx_file",
      limits: parserLimits()
    })).rejects.toMatchObject({ code: "parser.pptx.invalid_xml" });
  });

  it("enforces the archive entry-count bound before extraction", async () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
    const filePath = await writeFixture("entries.docx", await createOpenXmlZip(docxRequiredEntries(documentXml)));

    await expect(extractOfficeText({
      requestId: "docx-entry-bound",
      filePath,
      sourceKind: "docx_file",
      limits: parserLimits({ maxEntries: 1 })
    })).rejects.toMatchObject({ code: "parser.docx.too_many_entries" });
  });

  it("rejects suspiciously compressed OpenXML packages", async () => {
    const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body/></w:document>`;
    const filePath = await writeFixture("compression.docx", await createOpenXmlZip([
      ...docxRequiredEntries(documentXml),
      { name: "word/media/compressed.bin", data: Buffer.alloc(4 * 1024 * 1024) }
    ]));

    await expect(extractOfficeText({
      requestId: "docx-compression",
      filePath,
      sourceKind: "docx_file",
      limits: parserLimits()
    })).rejects.toMatchObject({ code: "parser.docx.suspicious_compression" });
  });
});

function parserLimits(overrides: Partial<OfficeParserLimits> = {}): OfficeParserLimits {
  return {
    maxBytes: OFFICE_PARSER_MAX_BYTES,
    maxEntries: OFFICE_PARSER_MAX_ENTRIES,
    maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
    maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
    maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
    maxSlides: OFFICE_PARSER_MAX_SLIDES,
    maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS,
    ...overrides
  };
}

async function writeFixture(name: string, value: Buffer): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-office-parser-test-"));
  tempRoots.push(root);
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, value);
  return filePath;
}
