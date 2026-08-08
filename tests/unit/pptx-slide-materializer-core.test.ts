import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { afterEach, describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import {
  materializePptxSlides,
  PPTX_SLIDE_MATERIALIZER_DEFAULT_LIMITS,
  PPTX_SLIDE_MATERIALIZER_ID,
  PPTX_SLIDE_MATERIALIZER_MAX_PIXELS,
  PPTX_SLIDE_MATERIALIZER_MAX_SLIDES,
  PPTX_SLIDE_MATERIALIZER_VERSION,
  type PptxSlideMaterializerRequest
} from "../../apps/desktop/src/main/services/pptx-slide-materializer-core";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_VERSION
} from "../../apps/desktop/src/main/services/office-parser-types";
import { createTestPptx } from "./helpers/office-fixture";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PPTX slide materializer core", () => {
  it("renders a parser-selected slide to in-memory PNG pixels", async () => {
    const filePath = writeFixture(await createTestPptx(), "presentation.pptx");
    const result = await materializePptxSlides(request(filePath, ["slide:1"]));

    expect(result).toMatchObject({
      protocolVersion: 1,
      materializerId: PPTX_SLIDE_MATERIALIZER_ID,
      materializerVersion: PPTX_SLIDE_MATERIALIZER_VERSION,
      requestedSlides: [1],
      renderedSlides: [1],
      renderIncomplete: false,
      warnings: []
    });
    const slide = result.slides[0];
    if (!slide) throw new Error("Expected one rendered slide.");
    expect(slide).toMatchObject({
      slide: 1,
      locator: "slide:1/render",
      mimeType: "image/png",
      pngByteSize: slide.png.byteLength
    });
    expect(slide.width * slide.height).toBeLessThanOrEqual(PPTX_SLIDE_MATERIALIZER_MAX_PIXELS);
    expect(Array.from(slide.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const image = await loadImage(Buffer.from(slide.png));
    const decoded = createCanvas(slide.width, slide.height);
    decoded.getContext("2d").drawImage(image, 0, 0);
    expect(decoded.getContext("2d").getImageData(0, 0, 1, 1).data[0]).toBeGreaterThan(200);
    decoded.width = 0;
    decoded.height = 0;
  });

  it("rejects parser order drift, source drift, and over-bound slide selections before rendering", async () => {
    const filePath = writeFixture(await createTestPptx(), "presentation.pptx");
    const reordered = request(filePath, ["slide:2", "slide:1"]);
    await expect(materializePptxSlides({
      ...reordered,
      parser: { ...reordered.parser, slideLocators: ["slide:1", "slide:2"] }
    })).rejects.toMatchObject<PigeDomainError>({
      code: "parser.pptx.materializer_provenance_mismatch"
    });
    await expect(materializePptxSlides({
      ...request(filePath, ["slide:1"]),
      sourceChecksum: "sha256:" + "0".repeat(64),
      parser: { ...request(filePath, ["slide:1"]).parser, sourceChecksum: "sha256:" + "0".repeat(64) }
    })).rejects.toMatchObject<PigeDomainError>({ code: "parser.pptx.source_changed" });
    await expect(materializePptxSlides({
      ...request(filePath, ["slide:1"]),
      slideLocators: Array.from({ length: PPTX_SLIDE_MATERIALIZER_MAX_SLIDES + 1 }, (_, index) => `slide:${index + 1}`),
      parser: { ...request(filePath, ["slide:1"]).parser, slideLocators: Array.from({ length: PPTX_SLIDE_MATERIALIZER_MAX_SLIDES + 1 }, (_, index) => `slide:${index + 1}`) }
    })).rejects.toMatchObject<PigeDomainError>({ code: "parser.pptx.materializer_invalid_request" });
  });

  it("rejects unsafe inputs and never follows an external slide relationship", async () => {
    const filePath = writeFixture(await createTestPptx(), "presentation.pptx");
    await expect(materializePptxSlides({ ...request(filePath, ["slide:1"]), filePath: "relative.pptx" }))
      .rejects.toMatchObject<PigeDomainError>({ code: "parser.pptx.materializer_invalid_request" });
    await expect(materializePptxSlides({
      ...request(filePath, ["slide:1"]),
      limits: { ...PPTX_SLIDE_MATERIALIZER_DEFAULT_LIMITS, maxPixels: PPTX_SLIDE_MATERIALIZER_MAX_PIXELS + 1 }
    })).rejects.toMatchObject<PigeDomainError>({ code: "parser.pptx.materializer_invalid_request" });
  });
});

function request(filePath: string, slideLocators: readonly string[]): PptxSlideMaterializerRequest {
  const sourceChecksum = checksum(fs.readFileSync(filePath));
  return {
    protocolVersion: 1,
    requestId: "pptx-materializer-test",
    filePath,
    sourceChecksum,
    parser: {
      artifactId: "art_pptx_parse_metadata",
      checksum: "sha256:" + "1".repeat(64),
      sourceChecksum,
      parserId: OFFICE_PARSER_ID,
      parserEngine: OFFICE_PARSER_ENGINE,
      parserVersion: OFFICE_PARSER_VERSION,
      slideLocators
    },
    slideLocators,
    limits: PPTX_SLIDE_MATERIALIZER_DEFAULT_LIMITS
  };
}

function checksum(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeFixture(contents: Buffer, name: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-pptx-slide-materializer-test-"));
  tempRoots.push(root);
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, contents);
  return filePath;
}
