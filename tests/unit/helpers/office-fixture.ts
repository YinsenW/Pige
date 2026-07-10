import { ZipFile } from "yazl";

export interface OpenXmlFixtureEntry {
  readonly name: string;
  readonly data: string | Buffer;
  readonly compress?: boolean;
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

export async function createOpenXmlZip(entries: readonly OpenXmlFixtureEntry[]): Promise<Buffer> {
  const zip = new ZipFile();
  for (const entry of entries) {
    zip.addBuffer(typeof entry.data === "string" ? Buffer.from(entry.data, "utf8") : entry.data, entry.name, {
      compress: entry.compress ?? true,
      mtime: new Date("2026-07-09T12:00:00.000Z"),
      mode: 0o100644
    });
  }
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

export async function createTestDocx(): Promise<Buffer> {
  return createOpenXmlZip([
    { name: "[Content_Types].xml", data: contentTypes([
      ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"],
      ["/word/styles.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"],
      ["/word/numbering.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"],
      ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"]
    ], true) },
    { name: "_rels/.rels", data: rootRelationships("word/document.xml") },
    { name: "docProps/core.xml", data: coreProperties("DOCX Knowledge") },
    { name: "word/styles.xml", data: DOCX_STYLES },
    { name: "word/numbering.xml", data: DOCX_NUMBERING },
    { name: "word/_rels/document.xml.rels", data: DOCX_RELATIONSHIPS },
    { name: "word/document.xml", data: DOCX_DOCUMENT },
    { name: "word/media/image1.png", data: TINY_PNG }
  ]);
}

export async function createTestPptx(): Promise<Buffer> {
  return createOpenXmlZip([
    { name: "[Content_Types].xml", data: contentTypes([
      ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
      ["/ppt/slides/slide1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"],
      ["/ppt/slides/slide2.xml", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"],
      ["/ppt/notesSlides/notesSlide1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"],
      ["/docProps/core.xml", "application/vnd.openxmlformats-package.core-properties+xml"]
    ], true) },
    { name: "_rels/.rels", data: rootRelationships("ppt/presentation.xml") },
    { name: "docProps/core.xml", data: coreProperties("PPTX Knowledge") },
    { name: "ppt/presentation.xml", data: PPTX_PRESENTATION },
    { name: "ppt/_rels/presentation.xml.rels", data: PPTX_PRESENTATION_RELATIONSHIPS },
    { name: "ppt/slides/slide1.xml", data: slideXml("Second in presentation order", "Supporting detail") },
    { name: "ppt/slides/slide2.xml", data: slideXml("Roadmap first", "Launch locally, then enrich with OCR") },
    { name: "ppt/slides/_rels/slide1.xml.rels", data: PPTX_SLIDE_ONE_RELATIONSHIPS },
    { name: "ppt/slides/_rels/slide2.xml.rels", data: PPTX_SLIDE_TWO_RELATIONSHIPS },
    { name: "ppt/notesSlides/notesSlide1.xml", data: notesXml("Speaker note: verify the local-first release gate.") },
    { name: "ppt/media/image1.png", data: TINY_PNG }
  ]);
}

export function docxRequiredEntries(documentXml: string): OpenXmlFixtureEntry[] {
  return [
    { name: "[Content_Types].xml", data: contentTypes([
      ["/word/document.xml", "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"]
    ]) },
    { name: "word/document.xml", data: documentXml }
  ];
}

export function pptxRequiredEntries(input: {
  readonly presentationXml?: string;
  readonly presentationRelationshipsXml?: string;
  readonly additional?: readonly OpenXmlFixtureEntry[];
} = {}): OpenXmlFixtureEntry[] {
  return [
    { name: "[Content_Types].xml", data: contentTypes([
      ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"]
    ]) },
    { name: "ppt/presentation.xml", data: input.presentationXml ?? PPTX_PRESENTATION },
    { name: "ppt/_rels/presentation.xml.rels", data: input.presentationRelationshipsXml ?? PPTX_PRESENTATION_RELATIONSHIPS },
    ...(input.additional ?? [])
  ];
}

function contentTypes(overrides: readonly (readonly [string, string])[], includePng = false): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  ${includePng ? '<Default Extension="png" ContentType="image/png"/>' : ""}
  ${overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`).join("\n  ")}
</Types>`;
}

function rootRelationships(target: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="${target}"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`;
}

function coreProperties(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>${title}</dc:title>
</cp:coreProperties>`;
}

function slideXml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${title}</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${body}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
}

function notesXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld>
</p:notes>`;
}

const DOCX_STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`;

const DOCX_NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="&#x2022;"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

const DOCX_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdHyperlink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/reference?token=fixture-secret" TargetMode="External"/>
  <Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

const DOCX_DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Local knowledge architecture</w:t></w:r></w:p>
    <w:p><w:r><w:t>Pige preserves readable structure and a safe </w:t></w:r><w:hyperlink r:id="rIdHyperlink"><w:r><w:t>reference link</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>
    <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Capture locally before enrichment</w:t></w:r></w:p>
    <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Owner</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Local Agent</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="9525" cy="9525"/><wp:docPr id="1" name="Fixture" descr="Architecture diagram"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image1.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdImage1"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="9525" cy="9525"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

const PPTX_PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/></p:sldIdLst>
</p:presentation>`;

const PPTX_PRESENTATION_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
</Relationships>`;

const PPTX_SLIDE_ONE_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdExternal" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/?token=fixture-secret" TargetMode="External"/>
</Relationships>`;

const PPTX_SLIDE_TWO_RELATIONSHIPS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
  <Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/>
</Relationships>`;
