import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  generatePackagedMemoryFixture,
  PACKAGED_MEMORY_CHUNKS_PER_PAGE
} from "../../apps/desktop/src/main/services/packaged-memory-fixture";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("packaged memory synthetic fixture", () => {
  it("creates deterministic bounded Markdown pages without overwriting a successor", () => {
    const firstRoot = makeRoot();
    const secondRoot = makeRoot();
    const first = generatePackagedMemoryFixture(firstRoot, 2);
    const second = generatePackagedMemoryFixture(secondRoot, 2);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      pageCount: 2,
      expectedChunkCount: 2 * PACKAGED_MEMORY_CHUNKS_PER_PAGE,
      firstPageId: "page_20260715_00000000"
    });
    expect(first.fixtureSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => generatePackagedMemoryFixture(firstRoot, 2)).toThrow(/EEXIST/u);
  });

  it("rejects empty and over-bound fixture requests", () => {
    const root = makeRoot();
    expect(() => generatePackagedMemoryFixture(root, 0)).toThrow("outside the reviewed bound");
    expect(() => generatePackagedMemoryFixture(root, 10_001)).toThrow("outside the reviewed bound");
  });
});

function makeRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-packaged-memory-fixture-"));
  tempRoots.push(root);
  return root;
}
