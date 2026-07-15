import { describe, expect, it, vi } from "vitest";

import { createPackagedMemoryApplicationDependencies } from
  "../../apps/desktop/src/main/services/packaged-memory-application-evidence";

describe("packaged memory application evidence adapters", () => {
  it("binds ordinary evidence to capture and renderer/preload IPC results", async () => {
    const submitText = vi.fn(() => ({ status: "queued" }));
    const executeJavaScript = vi.fn(async () => ({
      notePageId: "page_20260715_00000000",
      renderedPageId: "page_20260715_00000000",
      renderedBytes: 512,
      searchMode: "lexical_sqlite_fts",
      searchResultCount: 8
    }));
    const dependencies = createPackagedMemoryApplicationDependencies({
      browserWindow: { webContents: { executeJavaScript } } as never,
      capture: { submitText },
      database: databasePort(),
      heavyJob: heavyJobPort(),
      vaultPath: "/synthetic-vault",
      firstPageId: "page_20260715_00000000",
      sample: memorySample
    });

    await expect(dependencies.performOrdinaryAction(0)).resolves.toEqual({
      capturedBytes: 1_024,
      noteRead: true,
      noteRendered: true,
      searched: true
    });
    await expect(dependencies.performOrdinaryAction(1)).resolves.toMatchObject({ capturedBytes: 0 });
    expect(submitText).toHaveBeenCalledTimes(1);
    expect(submitText.mock.calls[0]?.[0]).toMatchObject({
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    expect(Buffer.byteLength(submitText.mock.calls[0]?.[0].text ?? "", "utf8")).toBe(1_024);
    expect(executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it("binds heavy evidence to the exact real worker result and chunk status", async () => {
    const database = databasePort();
    const dependencies = createPackagedMemoryApplicationDependencies({
      browserWindow: { webContents: { executeJavaScript: vi.fn() } } as never,
      capture: { submitText: vi.fn() },
      database,
      heavyJob: heavyJobPort(),
      vaultPath: "/synthetic-vault",
      firstPageId: "page_20260715_00000000",
      sample: memorySample
    });

    await expect(dependencies.performHeavyWork()).resolves.toEqual({
      jobClass: "index_rebuild",
      terminalState: "completed",
      pageCount: 10_000,
      chunkCount: 100_000,
      invalidPageCount: 0,
      progressEventCount: 2
    });
    expect(database.chunkIndexStatus).toHaveBeenCalledWith("/synthetic-vault");
  });

  it("fails closed when renderer or scale identities do not match", async () => {
    const invalidRenderer = createPackagedMemoryApplicationDependencies({
      browserWindow: {
        webContents: { executeJavaScript: vi.fn(async () => ({ searchMode: "lexical_sqlite_fts" })) }
      } as never,
      capture: { submitText: vi.fn(() => ({ status: "queued" })) },
      database: databasePort(),
      heavyJob: heavyJobPort(),
      vaultPath: "/synthetic-vault",
      firstPageId: "page_20260715_00000000",
      sample: memorySample
    });
    await expect(invalidRenderer.performOrdinaryAction(0)).rejects.toThrow("renderer knowledge cycle");

    const database = databasePort();
    database.chunkIndexStatus.mockReturnValue({ chunkCount: 99_999 });
    const invalidHeavy = createPackagedMemoryApplicationDependencies({
      browserWindow: { webContents: { executeJavaScript: vi.fn() } } as never,
      capture: { submitText: vi.fn() },
      database,
      heavyJob: heavyJobPort(),
      vaultPath: "/synthetic-vault",
      firstPageId: "page_20260715_00000000",
      sample: memorySample
    });
    await expect(invalidHeavy.performHeavyWork()).rejects.toThrow("scale identity");
  });
});

function databasePort() {
  return {
    chunkIndexStatus: vi.fn(() => ({ chunkCount: 100_000 }))
  };
}

function heavyJobPort() {
  return {
    requestIndexRebuild: vi.fn(async (options: { readonly onProgress: () => void }) => {
      options.onProgress();
      options.onProgress();
      return {
        pageCount: 10_000,
        invalidPageCount: 0,
        jobId: "job_20260715_abcdefgh",
        state: "completed"
      };
    }),
    readIndexRebuild: vi.fn(() => ({
      class: "index_rebuild",
      state: "completed",
      progress: { completedUnits: 10_000 }
    }))
  };
}

function memorySample() {
  return {
    residentBytes: 1,
    processCount: 2,
    processTypeCounts: { Browser: 1, Tab: 1 }
  };
}
