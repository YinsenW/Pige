import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FAST_XML_PARSER_VERSION,
  MAMMOTH_VERSION,
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
  OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
  OFFICE_MEDIA_MATERIALIZER_TIMEOUT_MS,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
  OFFICE_PARSER_MAX_SLIDES,
  OFFICE_PARSER_MAX_TEXT_CHARACTERS,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
  OFFICE_PARSER_TIMEOUT_MS,
  YAUZL_VERSION
} from "../../apps/desktop/src/main/services/office-parser-types";
import {
  PDF_PAGE_RENDERER_ID,
  PDF_PAGE_RENDERER_MAX_EDGE,
  PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES,
  PDF_PAGE_RENDERER_MAX_PAGES,
  PDF_PAGE_RENDERER_MAX_PDF_BYTES,
  PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE,
  PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE,
  PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES,
  PDF_PAGE_RENDERER_PROTOCOL_VERSION,
  PDF_PAGE_RENDERER_TIMEOUT_MS,
  PDF_PAGE_RENDERER_VERSION,
  PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB
} from "../../apps/desktop/src/main/services/pdf-page-renderer-types";

const root = process.cwd();
const manifestRoot = path.join(root, "resources/parser-manifests");

function readManifest(name: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(manifestRoot, name), "utf8")) as Record<string, unknown>;
}

describe("parser and OCR release manifests", () => {
  it("keeps Office engine versions and every enforced extraction limit aligned with code", () => {
    const manifest = readManifest("office-openxml.parser.manifest.json") as {
      engines: Array<{ id: string; version: string }>;
      limits: Record<string, number>;
    };

    expect(Object.fromEntries(manifest.engines.map((engine) => [engine.id, engine.version]))).toEqual({
      mammoth: MAMMOTH_VERSION,
      "fast-xml-parser": FAST_XML_PARSER_VERSION,
      yauzl: YAUZL_VERSION
    });
    expect(manifest.limits).toEqual({
      maxBytes: OFFICE_PARSER_MAX_BYTES,
      maxEntries: OFFICE_PARSER_MAX_ENTRIES,
      maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
      maxXmlEntryBytes: OFFICE_PARSER_MAX_XML_ENTRY_BYTES,
      maxSelectedXmlBytes: OFFICE_PARSER_MAX_SELECTED_XML_BYTES,
      maxSlides: OFFICE_PARSER_MAX_SLIDES,
      maxTextCharacters: OFFICE_PARSER_MAX_TEXT_CHARACTERS,
      timeoutMs: OFFICE_PARSER_TIMEOUT_MS,
      maxMediaTargets: OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
      maxMediaBytesPerItem: OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
      maxMediaTotalBytes: OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
      mediaMaterializerTimeoutMs: OFFICE_MEDIA_MATERIALIZER_TIMEOUT_MS
    });
  });

  it("indexes the bounded PDF page materializer and keeps every worker budget aligned with code", () => {
    const manifest = readManifest("pdf-page-materializer.manifest.json") as {
      id: string;
      protocolVersion: number;
      rendererVersion: string;
      workerPath: string;
      servicePath: string;
      limits: Record<string, number>;
    };

    expect(manifest.id).toBe(PDF_PAGE_RENDERER_ID);
    expect(manifest.protocolVersion).toBe(PDF_PAGE_RENDERER_PROTOCOL_VERSION);
    expect(manifest.rendererVersion).toBe(PDF_PAGE_RENDERER_VERSION);
    expect(manifest.limits).toEqual({
      maxPdfBytes: PDF_PAGE_RENDERER_MAX_PDF_BYTES,
      maxPages: PDF_PAGE_RENDERER_MAX_PAGES,
      maxPageCandidates: PDF_PAGE_RENDERER_MAX_PAGE_CANDIDATES,
      maxEdge: PDF_PAGE_RENDERER_MAX_EDGE,
      maxPixelsPerPage: PDF_PAGE_RENDERER_MAX_PIXELS_PER_PAGE,
      maxPngBytesPerPage: PDF_PAGE_RENDERER_MAX_PNG_BYTES_PER_PAGE,
      maxTotalPngBytes: PDF_PAGE_RENDERER_MAX_TOTAL_PNG_BYTES,
      maxOldGenerationSizeMb: PDF_PAGE_RENDERER_WORKER_OLD_GENERATION_MB,
      timeoutMs: PDF_PAGE_RENDERER_TIMEOUT_MS
    });
    expect(fs.existsSync(path.join(root, manifest.workerPath))).toBe(true);
    expect(fs.existsSync(path.join(root, manifest.servicePath))).toBe(true);
  });

  it("lists every current parser/OCR manifest and leaves no empty provider-catalog placeholder", () => {
    const actual = fs.readdirSync(manifestRoot).filter((name) => name.endsWith(".json")).sort();
    const readme = fs.readFileSync(path.join(manifestRoot, "README.md"), "utf8");
    const indexed = [...readme.matchAll(/`([^`]+\.json)`/gu)].map((match) => match[1]).sort();

    expect(indexed).toEqual(actual);
    expect(fs.existsSync(path.join(root, "resources/provider-catalog"))).toBe(false);
  });
});
