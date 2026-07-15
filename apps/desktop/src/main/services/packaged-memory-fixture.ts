import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PACKAGED_MEMORY_CHUNKS_PER_PAGE = 10;

export interface PackagedMemoryFixtureResult {
  readonly pageCount: number;
  readonly expectedChunkCount: number;
  readonly fixtureSha256: string;
  readonly firstPageId: string;
}

export function generatePackagedMemoryFixture(
  vaultPath: string,
  pageCount: number
): PackagedMemoryFixtureResult {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10_000) {
    throw new Error("Packaged memory fixture page count is outside the reviewed bound.");
  }
  const digest = createHash("sha256");
  for (let index = 0; index < pageCount; index += 1) {
    const ordinal = String(index).padStart(5, "0");
    const relativePath = `wiki/scale/${String(Math.floor(index / 1_000)).padStart(2, "0")}/page-${ordinal}.md`;
    const content = createScalePage(index);
    const filePath = path.join(vaultPath, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    digest.update(relativePath).update("\0").update(content).update("\0");
  }
  return Object.freeze({
    pageCount,
    expectedChunkCount: pageCount * PACKAGED_MEMORY_CHUNKS_PER_PAGE,
    fixtureSha256: digest.digest("hex"),
    firstPageId: pageIdForIndex(0)
  });
}

function createScalePage(index: number): string {
  const sections = Array.from(
    { length: PACKAGED_MEMORY_CHUNKS_PER_PAGE },
    (_value, section) => `## Segment ${section + 1}

Synthetic scale evidence ${index}-${section + 1} exercises bounded local retrieval and chunk metadata. 本地规模检索证据 ${index}-${section + 1} 保持在确定性测试仓库中。`
  ).join("\n\n");
  return `---
id: "${pageIdForIndex(index)}"
schema_version: 1
title: "Scale Page ${String(index).padStart(5, "0")}"
type: "note"
created_at: "2026-07-15T00:00:00.000Z"
updated_at: "2026-07-15T00:00:00.000Z"
status: "active"
language: "en"
tags: []
source_ids: []
---

${sections}
`;
}

function pageIdForIndex(index: number): string {
  return `page_20260715_${index.toString(36).padStart(8, "0")}`;
}
