import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import type { RetrievalSearchRequest } from "@pige/contracts";
import { LibraryService } from "../../apps/desktop/src/main/services/library-service";
import {
  LocalDatabaseService,
  NodeSqliteDriver
} from "../../apps/desktop/src/main/services/local-database-service";
import { LocalDatabaseRebuildWorkerService } from "../../apps/desktop/src/main/services/local-database-rebuild-worker-service";
import { RetrievalService } from "../../apps/desktop/src/main/services/retrieval-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import {
  assertGeneratedReportEnvelope,
  generatedReportPath,
  writeGeneratedReport
} from "../../scripts/verify/generated-report-contract.mjs";
import { generateLocalScaleFixture } from "./helpers/local-scale-fixture";

const PAGE_COUNT = 10_000;
const CHUNK_COUNT = 100_000;
const LIBRARY_LIMIT_MS = 1_000;
const SEARCH_LIMIT_MS = 2_000;
const INLINE_REFERENCE_LIMIT_MS = 250;
const RECIPE = "pige-local-database-scale-v1";
const runScale = process.env.PIGE_RUN_SCALE_EVIDENCE === "1" ? it : it.skip;

describe("local database scale evidence", () => {
  runScale("rebuilds 10,000 Markdown pages into 100,000 product chunks with bounded warm APIs", async () => {
    const root = process.cwd();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-local-scale-"));
    try {
      const vault = createVaultOnDisk({
        parentDirectory: tempRoot,
        vaultName: "ScaleVault",
        appDataPath: path.join(tempRoot, "app-data"),
        tempPath: path.join(tempRoot, "temp"),
        now: new Date("2026-07-15T00:00:00.000Z")
      });
      const vaultPath = path.join(tempRoot, "ScaleVault");
      const fixture = generateLocalScaleFixture(vaultPath, PAGE_COUNT);
      const workerPath = path.join(root, "apps/desktop/out/main/workers/local-database-rebuild-worker.js");
      expect(fs.existsSync(workerPath)).toBe(true);
      const progress: number[] = [];
      const workerService = new LocalDatabaseRebuildWorkerService({
        workerUrl: pathToFileURL(workerPath),
        timeoutMs: 15 * 60 * 1_000
      });
      const database = new LocalDatabaseService(new NodeSqliteDriver(), workerService);
      const rebuildStarted = performance.now();
      const rebuilt = await database.rebuildInWorker(vaultPath, {
        onProgress: (update) => progress.push(update.completedUnits)
      });
      const rebuildMs = Math.round(performance.now() - rebuildStarted);
      const chunkStatus = database.chunkIndexStatus(vaultPath);
      const currentVault = loadVaultSummary(vaultPath);
      const vaultPort = {
        current: () => currentVault,
        activeVaultPath: () => vaultPath
      };
      const library = new LibraryService(vaultPort, database);
      const retrieval = new RetrievalService(vaultPort, database);
      const retrievalScope: RetrievalSearchRequest["scope"] = {
        kind: "active_vault",
        vaultId: currentVault.vaultId
      };

      expect(fixture).toMatchObject({ pageCount: PAGE_COUNT, expectedChunkCount: CHUNK_COUNT });
      expect(rebuilt).toMatchObject({ pageCount: PAGE_COUNT, invalidPageCount: 0 });
      expect(progress[0]).toBe(0);
      expect(progress.at(-1)).toBe((PAGE_COUNT * 2) + 1);
      expect(progress.every((value, index) => index === 0 || value >= (progress[index - 1] ?? 0))).toBe(true);
      expect(chunkStatus).toEqual({
        indexedPageCount: PAGE_COUNT,
        chunkCount: CHUNK_COUNT,
        chunkerVersion: "pige-markdown-v1",
        indexRevision: 5
      });

      const referenceRevision = database.inlineReferenceRevision(vaultPath);
      expect(referenceRevision).toMatch(/^5:/u);
      const referenceSamples = measureFive(() => database.inlineReferenceCandidates(vaultPath, {
        normalizedKey: "scale page 09999",
        expectedRevision: referenceRevision!
      }));
      expect(Math.max(...referenceSamples)).toBeLessThan(INLINE_REFERENCE_LIMIT_MS);
      expect(database.inlineReferenceCandidates(vaultPath, {
        normalizedKey: "scale page 09999",
        expectedRevision: referenceRevision!
      })?.map((page) => page.pageId)).toEqual(["page_20260715_000007pr"]);

      library.list({ limit: 50 });
      retrieval.search({ scope: retrievalScope, query: "bounded local retrieval", limit: 8 });
      retrieval.search({ scope: retrievalScope, query: "本地规模检索", limit: 8 });
      const librarySamples = measureFive(() => library.list({ limit: 50 }));
      const latinSamples = measureFive(() => retrieval.search({ scope: retrievalScope, query: "bounded local retrieval", limit: 8 }));
      const cjkSamples = measureFive(() => retrieval.search({ scope: retrievalScope, query: "本地规模检索", limit: 8 }));
      const libraryResult = library.list({ limit: 50 });
      const latinResult = retrieval.search({ scope: retrievalScope, query: "bounded local retrieval", limit: 8 });
      const cjkResult = retrieval.search({ scope: retrievalScope, query: "本地规模检索", limit: 8 });

      expect(Math.max(...librarySamples)).toBeLessThan(LIBRARY_LIMIT_MS);
      expect(Math.max(...latinSamples)).toBeLessThan(SEARCH_LIMIT_MS);
      expect(Math.max(...cjkSamples)).toBeLessThan(SEARCH_LIMIT_MS);
      expect(libraryResult).toMatchObject({ total: PAGE_COUNT, invalidPageCount: 0 });
      expect(libraryResult.pages).toHaveLength(50);
      expect(latinResult).toMatchObject({ mode: "lexical_sqlite_fts", degraded: false, total: PAGE_COUNT });
      expect(cjkResult).toMatchObject({ mode: "lexical_sqlite_fts", degraded: false, total: PAGE_COUNT });
      expect(latinResult.results).toHaveLength(8);
      expect(cjkResult.results).toHaveLength(8);

      const platform = checkedPlatformLabel();
      const buildId = process.env.PIGE_SCALE_BUILD_ID ?? "local-scale";
      const candidate = readCandidateContentIdentity(root);
      const report = {
        schemaVersion: 1,
        status: "passed",
        generatedAt: new Date().toISOString(),
        recipe: RECIPE,
        recipeSha256: sha256(JSON.stringify({
          recipe: RECIPE,
          pageCount: PAGE_COUNT,
          chunkCount: CHUNK_COUNT,
          fixtureSha256: fixture.fixtureSha256,
          candidateDigestSha256: candidate.digestSha256
        })),
        platform,
        buildId,
        baselineRevision: process.env.PIGE_BASELINE_REVISION ?? "0000000000000000000000000000000000000000",
        fixture: {
          fixtureId: "generated-local-scale-v1",
          pageCount: fixture.pageCount,
          expectedChunkCount: fixture.expectedChunkCount,
          fixtureSha256: fixture.fixtureSha256,
          synthetic: true
        },
        candidate,
        index: {
          driver: "node_sqlite",
          indexRevision: chunkStatus?.indexRevision ?? 0,
          chunkerVersion: chunkStatus?.chunkerVersion ?? "unknown",
          pageRowCount: rebuilt.pageCount,
          chunkRowCount: chunkStatus?.chunkCount ?? 0,
          invalidPageCount: rebuilt.invalidPageCount,
          rebuildMs,
          progressEventCount: progress.length
        },
        measurements: [
          measurement("library-warm-list", librarySamples, LIBRARY_LIMIT_MS, libraryResult.pages.length, libraryResult),
          measurement("latin-warm-search", latinSamples, SEARCH_LIMIT_MS, latinResult.results.length, latinResult),
          measurement("cjk-warm-search", cjkSamples, SEARCH_LIMIT_MS, cjkResult.results.length, cjkResult)
        ],
        scope: {
          productRebuild: true,
          packagedMemoryAcceptance: false,
          semanticVectorRetrieval: false
        }
      };
      assertGeneratedReportEnvelope(report, RECIPE);
      const reportPath = generatedReportPath(root, "local-database-scale", platform, buildId);
      writeGeneratedReport(root, reportPath, report);
      expect(JSON.stringify(report)).not.toContain(vault.activeVaultPathDisplay);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }, 20 * 60 * 1_000);
});

function measureFive<T>(work: () => T): readonly number[] {
  return Array.from({ length: 5 }, () => {
    const started = performance.now();
    work();
    return Math.round((performance.now() - started) * 100) / 100;
  });
}

function measurement(
  caseId: string,
  samplesMs: readonly number[],
  limitMs: number,
  returnedCount: number,
  result: unknown
) {
  return {
    caseId,
    samplesMs,
    maximumMs: Math.max(...samplesMs),
    limitMs,
    returnedCount,
    serializedBytes: Buffer.byteLength(JSON.stringify(result), "utf8")
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readCandidateContentIdentity(root: string): {
  readonly digestSha256: string;
  readonly changedFileCount: number;
} {
  const tracked = gitNullList(root, ["diff", "--name-only", "-z", "HEAD"]);
  const untracked = gitNullList(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const files = Array.from(new Set([...tracked, ...untracked])).sort((left, right) => left.localeCompare(right, "en-US"));
  const digest = createHash("sha256");
  for (const relative of files) {
    const absolute = path.join(root, ...relative.split("/"));
    digest.update(relative).update("\0");
    digest.update(fs.existsSync(absolute) ? fs.readFileSync(absolute) : Buffer.from("deleted", "utf8"));
    digest.update("\0");
  }
  return { digestSha256: digest.digest("hex"), changedFileCount: files.length };
}

function gitNullList(root: string, args: readonly string[]): readonly string[] {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function checkedPlatformLabel(): "macos-arm64" | "windows-x64" | "linux-x64" {
  if (process.platform === "darwin" && process.arch === "arm64") return "macos-arm64";
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  throw new Error("Local database scale evidence is not defined for this platform architecture.");
}
