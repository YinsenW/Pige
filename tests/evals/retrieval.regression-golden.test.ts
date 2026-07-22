import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateRetrievalGoldenFixture,
  type RetrievalEvalReport,
  type RetrievalGoldenFixture,
  type RetrievalQueryObservation,
  type RetrievalRelatedObservation
} from "@pige/test-fixtures";
import type { VaultSummary } from "@pige/contracts";
import { LibraryService } from "../../apps/desktop/src/main/services/library-service";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import {
  buildHomeQueryContextPack,
  RetrievalService
} from "../../apps/desktop/src/main/services/retrieval-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];
const fixture = JSON.parse(fs.readFileSync(
  path.join(process.cwd(), "tests/fixtures/evals/retrieval/retrieval-golden.v1.json"),
  "utf8"
)) as RetrievalGoldenFixture;

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("retrieval regression golden evaluation", () => {
  it("passes deterministic ranking, citation, distractor, related-page, and insufficient-evidence gates", () => {
    expect(fixture.schemaVersion).toBe(1);
    expect(fixture.version).toBe("1.0.0");
    expect(new Set(fixture.pages.map((page) => page.pageId)).size).toBe(fixture.pages.length);
    expect(new Set(fixture.queries.map((query) => query.id)).size).toBe(fixture.queries.length);
    expect(new Set(fixture.pages.map((page) => page.language))).toEqual(new Set(["en", "zh-Hans"]));

    const observations = runFixture(fixture);
    const evaluation = evaluateRetrievalGoldenFixture(
      fixture,
      observations.queries,
      observations.related
    );

    expect(evaluation.errors).toEqual([]);
    expect(evaluation.metrics).toEqual({
      topResultAccuracy: 1,
      citationCoverage: 1,
      unsupportedCitationCount: 0,
      knownDistractorTop1Count: 0,
      relatedPageRecall: 1,
      insufficientEvidenceAccuracy: 1
    });
    expect(evaluation.report).toEqual(evaluateRetrievalGoldenFixture(
      fixture,
      observations.queries,
      observations.related
    ).report);

    const serializedReport = serializeReport(evaluation.report);
    for (const sentinel of fixture.privateSentinels) expect(serializedReport).not.toContain(sentinel);
    expect(serializedReport).not.toContain("pagePath");
    expect(serializedReport).not.toContain("snippets");
    expect(serializedReport).not.toContain("title");
    expect(serializedReport).not.toContain("query\"");
    expect(Buffer.byteLength(serializedReport)).toBeLessThan(16 * 1024);

    writeRequestedReport(serializedReport);
  });

  it("fails the same metrics for a distractor, fabricated citation, missing link, and false confident answer", () => {
    const observations = runFixture(fixture);
    const first = requireValue(observations.queries[0]);
    const insufficient = requireValue(observations.queries.find((query) =>
      query.queryId === "query-insufficient-lunar-orchard"
    ));
    const related = requireValue(observations.related[0]);
    const mutatedQueries = observations.queries.map((query) => {
      if (query.queryId === first.queryId) {
        return {
          ...query,
          topPageId: "page_20260711_clouddistract",
          citationPageIds: [...query.citationPageIds, "page_20260711_fabricated"]
        };
      }
      if (query.queryId === insufficient.queryId) {
        return {
          ...query,
          topPageId: "page_20260711_ocrprimary",
          citationPageIds: ["page_20260711_ocrprimary"],
          confidence: "grounded" as const,
          warnings: []
        };
      }
      return query;
    });
    const mutatedRelated = observations.related.map((observation) => observation.caseId === related.caseId
      ? { ...observation, outgoingPageIds: [] }
      : observation);

    const evaluation = evaluateRetrievalGoldenFixture(fixture, mutatedQueries, mutatedRelated);

    expect(evaluation.metrics.topResultAccuracy).toBeLessThan(1);
    expect(evaluation.metrics.unsupportedCitationCount).toBe(2);
    expect(evaluation.metrics.knownDistractorTop1Count).toBe(1);
    expect(evaluation.metrics.relatedPageRecall).toBeLessThan(1);
    expect(evaluation.metrics.insufficientEvidenceAccuracy).toBe(0);
    expect(evaluation.errors.length).toBeGreaterThanOrEqual(5);
  });

  it("rejects report output outside the governed artifact directory", () => {
    const artifactRoot = path.join(process.cwd(), "artifacts/test-reports/retrieval-regression");
    const validPath = path.join(artifactRoot, "test-platform", "test-build", "report.json");

    expect(resolveRequestedReportPath(validPath)).toBe(path.resolve(validPath));
    expect(() => resolveRequestedReportPath(path.join(os.tmpdir(), "report.json")))
      .toThrow("Retrieval report path must stay inside");
    expect(() => resolveRequestedReportPath(path.join(artifactRoot, "report.txt")))
      .toThrow("Retrieval report filename must be report.json");
  });
});

function runFixture(input: RetrievalGoldenFixture): {
  readonly queries: readonly RetrievalQueryObservation[];
  readonly related: readonly RetrievalRelatedObservation[];
} {
  const { vaultPath, vault } = makeVault();
  for (const page of input.pages) writePage(vaultPath, page);
  const vaultPort = { current: () => vault, activeVaultPath: () => vaultPath };
  const database = new LocalDatabaseService();
  const retrieval = new RetrievalService(vaultPort, database);
  const library = new LibraryService(vaultPort, database);

  const queries = input.queries.map((query): RetrievalQueryObservation => {
    const result = retrieval.search({
      scope: { kind: "active_vault", vaultId: vault.vaultId },
      query: query.query,
      limit: query.limit
    });
    const context = buildHomeQueryContextPack(result);
    const evidence = context.selectedEvidence.slice(0, 3);
    expect(result.mode, query.id).toBe("lexical_sqlite_fts");
    expect(result.degraded, query.id).toBe(false);
    return {
      queryId: query.id,
      ...(result.results[0]?.summary.pageId ? { topPageId: result.results[0].summary.pageId } : {}),
      resultPageIds: result.results.map((item) => item.summary.pageId),
      citationPageIds: evidence.map((item) => item.citation.pageId),
      confidence: evidence.length === 0
        ? "insufficient"
        : evidence.length === 1
          ? "limited"
          : "grounded",
      warnings: context.pack.warnings
    };
  });
  const related = input.relatedCases.map((relatedCase): RetrievalRelatedObservation => {
    const result = library.related({ pageId: relatedCase.pageId, limit: 20 });
    expect(result.degraded, relatedCase.id).toBe(false);
    return {
      caseId: relatedCase.id,
      outgoingPageIds: result.outgoing.map((page) => page.summary.pageId),
      backlinkPageIds: result.backlinks.map((page) => page.summary.pageId)
    };
  });
  return { queries, related };
}

function makeVault(): { readonly vaultPath: string; readonly vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-retrieval-eval-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "RetrievalGolden",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-11T04:00:00.000Z")
  });
  const vaultPath = path.join(root, "RetrievalGolden");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function writePage(vaultPath: string, page: RetrievalGoldenFixture["pages"][number]): void {
  const filePath = path.join(vaultPath, ...page.pagePath.split("/"));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `---
id: "${page.pageId}"
schema_version: 1
title: "${page.title}"
type: "${page.pageType}"
created_at: "2026-07-11T04:00:00.000Z"
updated_at: "2026-07-11T04:00:00.000Z"
status: "active"
language: "${page.language}"
source_ids: []
---

# ${page.title}

${page.body}
`, "utf8");
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected fixture value is missing.");
  return value;
}

function serializeReport(report: RetrievalEvalReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

function writeRequestedReport(serializedReport: string): void {
  const requestedPath = process.env.PIGE_RETRIEVAL_REPORT_PATH;
  if (!requestedPath) return;

  const reportPath = resolveRequestedReportPath(requestedPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${reportPath}.${process.pid}.tmp`;
  const noFollow = fs.constants.O_NOFOLLOW ?? 0;
  let descriptor: number | undefined;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | noFollow,
      0o600
    );
    fs.writeFileSync(descriptor, serializedReport, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, reportPath);
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function resolveRequestedReportPath(requestedPath: string): string {
  const artifactRoot = path.resolve(process.cwd(), "artifacts/test-reports/retrieval-regression");
  const reportPath = path.resolve(requestedPath);
  const relativePath = path.relative(artifactRoot, reportPath);
  if (relativePath.length === 0 || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error("Retrieval report path must stay inside artifacts/test-reports/retrieval-regression.");
  }
  if (path.basename(reportPath) !== "report.json") {
    throw new Error("Retrieval report filename must be report.json.");
  }
  return reportPath;
}
