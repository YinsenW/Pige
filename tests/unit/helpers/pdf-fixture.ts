export function createTestPdf(pages: readonly string[], title = "Pige PDF Fixture"): Buffer {
  const objects = new Map<number, string>();
  const pageObjectIds: number[] = [];
  const fontObjectId = 3;
  let nextObjectId = 4;

  for (const pageText of pages) {
    const pageObjectId = nextObjectId;
    const contentObjectId = nextObjectId + 1;
    nextObjectId += 2;
    pageObjectIds.push(pageObjectId);
    const content = renderPageContent(pageText);
    objects.set(pageObjectId, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`);
    objects.set(contentObjectId, `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
  }

  const infoObjectId = nextObjectId;
  objects.set(1, "<< /Type /Catalog /Pages 2 0 R >>");
  objects.set(2, `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`);
  objects.set(fontObjectId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.set(infoObjectId, `<< /Title (${escapePdfString(title)}) >>`);

  const objectCount = Math.max(...objects.keys());
  let document = "%PDF-1.4\n%PIGE\n";
  const offsets = new Map<number, number>();
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    const body = objects.get(objectId);
    if (!body) throw new Error(`Missing PDF fixture object ${objectId}.`);
    offsets.set(objectId, Buffer.byteLength(document, "ascii"));
    document += `${objectId} 0 obj\n${body}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(document, "ascii");
  document += `xref\n0 ${objectCount + 1}\n`;
  document += "0000000000 65535 f \n";
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    document += `${String(offsets.get(objectId)).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoObjectId} 0 R >>\n`;
  document += `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(document, "ascii");
}

function renderPageContent(value: string): string {
  const lines = value.split(/\r?\n/u);
  if (lines.length === 1 && lines[0] === "") return "BT\nET";
  const operations = ["BT", "/F1 12 Tf", "15 TL", "72 720 Td"];
  lines.forEach((line, index) => {
    if (index > 0) operations.push("T*");
    operations.push(`(${escapePdfString(line)}) Tj`);
  });
  operations.push("ET");
  return operations.join("\n");
}

function escapePdfString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
