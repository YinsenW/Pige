import { createCanvas } from "@napi-rs/canvas";

const PAGE_WIDTH = 320;
const PAGE_HEIGHT = 180;

export function createJpegScanPdf(pageCount = 1): Buffer {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) throw new Error("Page count must be positive.");

  const canvas = createCanvas(PAGE_WIDTH, PAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#d94b45";
  context.fillRect(0, 0, PAGE_WIDTH / 2, PAGE_HEIGHT);
  context.fillStyle = "#28748c";
  context.fillRect(PAGE_WIDTH / 2, 0, PAGE_WIDTH / 2, PAGE_HEIGHT);
  context.fillStyle = "#ffffff";
  context.fillRect(48, 64, 64, 52);
  context.fillStyle = "#172126";
  context.fillRect(208, 64, 64, 52);
  const jpeg = canvas.toBuffer("image/jpeg", 0.92);
  canvas.width = 0;
  canvas.height = 0;

  const objects = new Map<number, Buffer>();
  const pageObjectIds: number[] = [];
  const imageObjectId = 3;
  let nextObjectId = 4;

  for (let index = 0; index < pageCount; index += 1) {
    const pageObjectId = nextObjectId;
    const contentObjectId = nextObjectId + 1;
    nextObjectId += 2;
    pageObjectIds.push(pageObjectId);
    const content = ascii(`q\n${PAGE_WIDTH} 0 0 ${PAGE_HEIGHT} 0 0 cm\n/Im0 Do\nQ`);
    objects.set(pageObjectId, ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /XObject << /Im0 ${imageObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    ));
    objects.set(contentObjectId, Buffer.concat([
      ascii(`<< /Length ${content.byteLength} >>\nstream\n`),
      content,
      ascii("\nendstream")
    ]));
  }

  objects.set(1, ascii("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, ascii(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`
  ));
  objects.set(imageObjectId, Buffer.concat([
    ascii(
      `<< /Type /XObject /Subtype /Image /Width ${PAGE_WIDTH} /Height ${PAGE_HEIGHT} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.byteLength} >>\nstream\n`
    ),
    jpeg,
    ascii("\nendstream")
  ]));

  return buildPdf(objects);
}

function buildPdf(objects: ReadonlyMap<number, Buffer>): Buffer {
  const objectCount = Math.max(...objects.keys());
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "binary")];
  const offsets = new Map<number, number>();
  let byteLength = chunks[0]?.byteLength ?? 0;

  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    const body = objects.get(objectId);
    if (!body) throw new Error(`Missing PDF fixture object ${objectId}.`);
    offsets.set(objectId, byteLength);
    const object = Buffer.concat([
      ascii(`${objectId} 0 obj\n`),
      body,
      ascii("\nendobj\n")
    ]);
    chunks.push(object);
    byteLength += object.byteLength;
  }

  const xrefOffset = byteLength;
  const xref = [
    `xref\n0 ${objectCount + 1}\n`,
    "0000000000 65535 f \n"
  ];
  for (let objectId = 1; objectId <= objectCount; objectId += 1) {
    xref.push(`${String(offsets.get(objectId)).padStart(10, "0")} 00000 n \n`);
  }
  xref.push(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\n`,
    `startxref\n${xrefOffset}\n%%EOF\n`
  );
  chunks.push(ascii(xref.join("")));
  return Buffer.concat(chunks);
}

function ascii(value: string): Buffer {
  return Buffer.from(value, "ascii");
}
