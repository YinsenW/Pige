import {
  generatePackagedMemoryFixture,
  PACKAGED_MEMORY_CHUNKS_PER_PAGE
} from "../../../apps/desktop/src/main/services/packaged-memory-fixture";

export const LOCAL_SCALE_CHUNKS_PER_PAGE = PACKAGED_MEMORY_CHUNKS_PER_PAGE;

export interface LocalScaleFixtureResult {
  readonly pageCount: number;
  readonly expectedChunkCount: number;
  readonly fixtureSha256: string;
}

export function generateLocalScaleFixture(
  vaultPath: string,
  pageCount: number
): LocalScaleFixtureResult {
  const fixture = generatePackagedMemoryFixture(vaultPath, pageCount);
  return {
    pageCount: fixture.pageCount,
    expectedChunkCount: fixture.expectedChunkCount,
    fixtureSha256: fixture.fixtureSha256
  };
}
