import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanMarkdownPages, readMarkdownPageBody } from "../../apps/desktop/src/main/services/markdown-page-index";
import { createMarkdownRagChunks } from "../../apps/desktop/src/main/services/rag-chunker";
import {
  generateLocalScaleFixture,
  LOCAL_SCALE_CHUNKS_PER_PAGE
} from "./helpers/local-scale-fixture";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("local scale fixture", () => {
  it("generates deterministic valid Markdown with ten product chunks per page", () => {
    const first = makeVault();
    const second = makeVault();
    const firstResult = generateLocalScaleFixture(first, 3);
    const secondResult = generateLocalScaleFixture(second, 3);

    expect(firstResult).toEqual(secondResult);
    expect(firstResult).toMatchObject({ pageCount: 3, expectedChunkCount: 30 });
    expect(firstResult.fixtureSha256).toMatch(/^[a-f0-9]{64}$/u);
    const scanned = scanMarkdownPages(first);
    expect(scanned).toMatchObject({ invalidPageCount: 0 });
    expect(scanned.pages).toHaveLength(3);
    for (const page of scanned.pages) {
      const chunks = createMarkdownRagChunks({
        pageId: page.summary.pageId,
        pagePath: page.summary.pagePath,
        pageType: page.summary.pageType,
        sourceIds: page.summary.sourceIds,
        body: readMarkdownPageBody(page.absolutePath)
      });
      expect(chunks).toHaveLength(LOCAL_SCALE_CHUNKS_PER_PAGE);
    }
  });

  it("rejects page counts outside the reviewed fixture bound", () => {
    const vaultPath = makeVault();
    expect(() => generateLocalScaleFixture(vaultPath, 0)).toThrow("outside the reviewed bound");
    expect(() => generateLocalScaleFixture(vaultPath, 10_001)).toThrow("outside the reviewed bound");
  });
});

function makeVault(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-scale-fixture-"));
  tempRoots.push(root);
  fs.mkdirSync(path.join(root, "wiki"), { recursive: true });
  return root;
}
