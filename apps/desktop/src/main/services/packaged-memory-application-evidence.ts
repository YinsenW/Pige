import type { BrowserWindow } from "electron";
import type { PackagedMemorySample } from "./packaged-memory-metrics";
import {
  runPackagedMemoryScenario,
  type PackagedMemoryScenarioDependencies,
  type PackagedMemoryScenarioEvidence
} from "./packaged-memory-scenario";

const FIXED_CAPTURE_TEXT = "x".repeat(1_024);
const FIXED_LATIN_QUERY = "bounded local retrieval";
const FIXED_CJK_QUERY = "本地规模检索";

export interface PackagedMemoryApplicationInput {
  readonly browserWindow: BrowserWindow;
  readonly capture: {
    readonly submitText: (request: {
      readonly text: string;
      readonly inputKind: "typed_text";
      readonly userIntent: "capture";
      readonly locale: "en";
    }) => { readonly status: string };
  };
  readonly database: {
    readonly chunkIndexStatus: (vaultPath: string) => { readonly chunkCount: number } | undefined;
  };
  readonly heavyJob: {
    readonly requestIndexRebuild: (options: {
      readonly onProgress: () => void;
    }) => Promise<{
      readonly pageCount: number;
      readonly invalidPageCount: number;
      readonly jobId?: string;
      readonly state?: string;
    }>;
    readonly readIndexRebuild: (jobId: string) => {
      readonly class: string;
      readonly state: string;
      readonly progress?: { readonly completedUnits: number } | undefined;
    } | undefined;
  };
  readonly vaultPath: string;
  readonly firstPageId: string;
  readonly sample: () => PackagedMemorySample;
}

export async function runPackagedMemoryApplicationEvidence(
  input: PackagedMemoryApplicationInput
): Promise<PackagedMemoryScenarioEvidence> {
  return runPackagedMemoryScenario(createPackagedMemoryApplicationDependencies(input));
}

export function createPackagedMemoryApplicationDependencies(
  input: PackagedMemoryApplicationInput
): PackagedMemoryScenarioDependencies {
  return {
    now: () => Math.round(performance.now()),
    sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    sample: input.sample,
    performOrdinaryAction: async (index) => {
      let capturedBytes = 0;
      if (index === 0) {
        const captured = input.capture.submitText({
          text: FIXED_CAPTURE_TEXT,
          inputKind: "typed_text",
          userIntent: "capture",
          locale: "en"
        });
        if (captured.status !== "queued") {
          throw new Error("Packaged memory capture did not reach its reviewed state.");
        }
        capturedBytes = Buffer.byteLength(FIXED_CAPTURE_TEXT, "utf8");
      }
      const result = await runRendererKnowledgeCycle(
        input.browserWindow,
        input.firstPageId,
        index % 2 === 0 ? FIXED_LATIN_QUERY : FIXED_CJK_QUERY
      );
      if (
        result.notePageId !== input.firstPageId ||
        result.renderedPageId !== input.firstPageId ||
        result.renderedBytes <= 0 ||
        result.searchMode !== "lexical_sqlite_fts" ||
        result.searchResultCount <= 0
      ) {
        throw new Error("Packaged memory renderer knowledge cycle returned invalid evidence.");
      }
      return {
        capturedBytes,
        noteRead: true,
        noteRendered: true,
        searched: true
      };
    },
    performHeavyWork: async () => {
      let progressEventCount = 0;
      const rebuilt = await input.heavyJob.requestIndexRebuild({
        onProgress: () => { progressEventCount += 1; }
      });
      if (!rebuilt.jobId) {
        throw new Error("Packaged memory heavy Job has no durable identity.");
      }
      const job = input.heavyJob.readIndexRebuild(rebuilt.jobId);
      if (
        job?.class !== "index_rebuild" ||
        job.state !== "completed" ||
        job.progress?.completedUnits === undefined ||
        job.progress.completedUnits <= 0 ||
        rebuilt.state !== "completed" ||
        progressEventCount <= 0
      ) {
        throw new Error("Packaged memory heavy Job did not reach its reviewed durable state.");
      }
      const chunks = input.database.chunkIndexStatus(input.vaultPath);
      return {
        jobClass: "index_rebuild",
        terminalState: "completed",
        pageCount: checkedLiteral(rebuilt.pageCount, 10_000),
        chunkCount: checkedLiteral(chunks?.chunkCount, 100_000),
        invalidPageCount: checkedLiteral(rebuilt.invalidPageCount, 0),
        progressEventCount
      };
    }
  };
}

async function runRendererKnowledgeCycle(
  browserWindow: BrowserWindow,
  pageId: string,
  query: string
): Promise<{
  readonly notePageId: string;
  readonly renderedPageId: string;
  readonly renderedBytes: number;
  readonly searchMode: string;
  readonly searchResultCount: number;
}> {
  const value = await browserWindow.webContents.executeJavaScript(`
    (async () => {
      const [note, rendered, search] = await Promise.all([
        window.pige?.notes?.get?.({ pageId: ${JSON.stringify(pageId)} }),
        window.pige?.notes?.render?.({ pageId: ${JSON.stringify(pageId)} }),
        window.pige?.retrieval?.search?.({ query: ${JSON.stringify(query)}, limit: 8 })
      ]);
      return {
        notePageId: note?.summary?.pageId,
        renderedPageId: rendered?.summary?.pageId,
        renderedBytes: rendered?.byteSize,
        searchMode: search?.mode,
        searchResultCount: search?.results?.length
      };
    })()
  `) as unknown;
  if (!isRendererKnowledgeResult(value)) {
    throw new Error("Packaged memory renderer knowledge cycle is invalid.");
  }
  return value;
}

function isRendererKnowledgeResult(value: unknown): value is {
  readonly notePageId: string;
  readonly renderedPageId: string;
  readonly renderedBytes: number;
  readonly searchMode: string;
  readonly searchResultCount: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(",") ===
      "notePageId,renderedBytes,renderedPageId,searchMode,searchResultCount" &&
    typeof record.notePageId === "string" &&
    typeof record.renderedPageId === "string" &&
    Number.isSafeInteger(record.renderedBytes) &&
    Number(record.renderedBytes) > 0 &&
    typeof record.searchMode === "string" &&
    Number.isSafeInteger(record.searchResultCount) &&
    Number(record.searchResultCount) > 0 &&
    Number(record.searchResultCount) <= 8;
}

function checkedLiteral<const Expected extends number>(
  value: number | undefined,
  expected: Expected
): Expected {
  if (value !== expected) {
    throw new Error("Packaged memory product result does not match its reviewed scale identity.");
  }
  return expected;
}
