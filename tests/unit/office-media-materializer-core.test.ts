import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeOfficeMedia } from "../../apps/desktop/src/main/services/office-media-materializer-core";
import {
  OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
  OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
  OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
  OFFICE_PARSER_MAX_BYTES,
  OFFICE_PARSER_MAX_ENTRIES,
  OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
  type OfficeMediaMaterializerRequest
} from "../../apps/desktop/src/main/services/office-parser-types";
import { createOpenXmlZip, createTestPptx, pptxRequiredEntries, TINY_PNG } from "./helpers/office-fixture";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Office media materializer core", () => {
  it("returns only parser-selected PPTX raster media in target order", async () => {
    const filePath = await writeFixture("media.pptx", await createTestPptx());
    const result = await materializeOfficeMedia(request(filePath, [target(2), target(1)]));

    expect(result).toMatchObject({
      materializerId: "office_openxml_media",
      materializerVersion: "1"
    });
    expect(result.media.map((media) => media.locator)).toEqual(["slide:2/media:1", "slide:1/media:1"]);
    expect(Buffer.from(result.media[0]!.bytes)).toEqual(TINY_PNG);
    expect(Buffer.from(result.media[1]!.bytes)).toEqual(TINY_PNG);
  });

  it("rejects a target whose parser-recorded size no longer matches the archive", async () => {
    const filePath = await writeFixture("changed.pptx", await createTestPptx());
    await expect(materializeOfficeMedia(request(filePath, [{ ...target(1), size: TINY_PNG.length + 1 }])))
      .rejects.toMatchObject({ code: "ocr.pptx.media_target_changed" });
  });

  it("rejects unsupported or escaping media targets before opening the archive", async () => {
    const filePath = await writeFixture("unsafe.pptx", await createTestPptx());
    await expect(materializeOfficeMedia(request(filePath, [{
      ...target(1),
      packagePath: "ppt/media/../../outside.svg",
      extension: ".svg"
    }]))).rejects.toMatchObject({ code: "ocr.pptx.media_target_invalid" });
  });

  it("reapplies archive expansion checks while materializing media", async () => {
    const filePath = await writeFixture("expanded.pptx", await createOpenXmlZip(pptxRequiredEntries({
      additional: [{ name: "ppt/media/image1.png", data: TINY_PNG }]
    })));
    await expect(materializeOfficeMedia(request(filePath, [target(1)], { maxUncompressedBytes: 16 })))
      .rejects.toMatchObject({ code: "parser.pptx.entry_too_large" });
  });
});

function target(slide: number) {
  return {
    slide,
    parentLocator: `slide:${slide}`,
    mediaIndex: 1,
    locator: `slide:${slide}/media:1`,
    packagePath: "ppt/media/image1.png",
    size: TINY_PNG.length,
    extension: ".png"
  } as const;
}

function request(
  filePath: string,
  targets: OfficeMediaMaterializerRequest["targets"],
  overrides: Partial<OfficeMediaMaterializerRequest["limits"]> = {}
): OfficeMediaMaterializerRequest {
  return {
    operation: "materialize_pptx_media",
    requestId: "office-media-test",
    filePath,
    sourceKind: "pptx_file",
    targets,
    limits: {
      maxBytes: OFFICE_PARSER_MAX_BYTES,
      maxEntries: OFFICE_PARSER_MAX_ENTRIES,
      maxUncompressedBytes: OFFICE_PARSER_MAX_UNCOMPRESSED_BYTES,
      maxTargets: OFFICE_MEDIA_MATERIALIZER_MAX_TARGETS,
      maxBytesPerItem: OFFICE_MEDIA_MATERIALIZER_MAX_BYTES_PER_ITEM,
      maxTotalBytes: OFFICE_MEDIA_MATERIALIZER_MAX_TOTAL_BYTES,
      ...overrides
    }
  };
}

async function writeFixture(name: string, value: Buffer): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-office-media-test-"));
  tempRoots.push(root);
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, value);
  return filePath;
}
