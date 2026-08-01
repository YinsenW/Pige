import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { OperationRecordSchema, type SourceRecord } from "@pige/schemas";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { DocumentParserService } from "../../apps/desktop/src/main/services/document-parser-service";
import { SourcePageService } from "../../apps/desktop/src/main/services/source-page-service";
import { SourceRefreshService } from "../../apps/desktop/src/main/services/source-refresh-service";
import { WebSourceRefreshService } from "../../apps/desktop/src/main/services/web-source-refresh-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("WebSourceRefreshService", () => {
  it("explicitly refreshes raw and extracted URL evidence, then restores it through Activity Undo", async () => {
    const fixture = await makeFixture();
    const web = new WebSourceRefreshService(vaultPort(fixture), {
      fetchSnapshot: async () => ({
        originalUrl: fixture.url,
        finalUrl: `${fixture.url}?version=2`,
        canonicalUrl: fixture.url,
        contentType: "text/html",
        charset: "utf-8",
        title: "Updated article",
        rawContent: "<html><body><main>Updated evidence.</main></body></html>",
        extractedText: "Updated evidence.",
        extraction: { parserId: "readability", engine: "mozilla_readability", version: "1", mode: "article",
          textCharacterCount: 17, elementCount: 2, truncated: false },
        warnings: []
      })
    });
    const service = new SourceRefreshService(fixture.port, new DocumentParserService(), undefined, undefined, web);

    expect(service.refreshableSourceIds([fixture.sourceId])).toEqual([fixture.sourceId]);
    const preview = await service.preview(request(fixture), () => true);
    expect(preview).toMatchObject({ status: "changed", preview: { sourceKind: "url", displayName: "Original article" } });
    expect(JSON.stringify(preview)).not.toContain(fixture.url);
    expect(JSON.stringify(preview)).not.toContain("Updated evidence");
    if (preview.status !== "changed") throw new Error("Expected changed preview");

    const result = await service.confirm({
      ...request(fixture),
      requestId: "sourcerefreshreq_confirmweb12345",
      previewId: preview.preview.previewId,
      expectedSourceRevision: preview.preview.expectedSourceRevision
    }, () => true);
    expect(result).toMatchObject({ status: "refreshed", sourcePageConflict: false });
    if (result.status !== "refreshed") throw new Error("Expected refreshed result");

    const refreshed = readRecord(fixture);
    const artifact = refreshed.artifacts.find((candidate) => candidate.kind === "extracted_text")!;
    expect(fs.readFileSync(path.join(fixture.vaultPath, artifact.path), "utf8")).toBe("Updated evidence.");
    expect(fs.readFileSync(path.join(fixture.vaultPath, refreshed.managedCopy!.path), "utf8"))
      .toContain("Updated evidence.");
    expect(refreshed.metadata).toMatchObject({ title: "Updated article", sourceRefreshOperationId: result.operationId });
    expect(fs.readFileSync(path.join(fixture.vaultPath, refreshed.knowledgePagePath!), "utf8"))
      .toContain("Updated evidence.");
    const operation = readOperation(fixture.vaultPath, result.operationId);
    expect(service.activitySummary(operation)).toMatchObject({ status: "applied", canUndo: true });

    expect(service.undo(operation)).toMatchObject({ status: "undone", operationId: result.operationId });
    const restored = readRecord(fixture);
    const restoredArtifact = restored.artifacts.find((candidate) => candidate.kind === "extracted_text")!;
    expect(fs.readFileSync(path.join(fixture.vaultPath, restoredArtifact.path), "utf8")).toBe("Original evidence.");
    expect(fs.readFileSync(path.join(fixture.vaultPath, restored.managedCopy!.path), "utf8"))
      .toContain("Original evidence.");
    expect(service.activitySummary(operation)).toMatchObject({ status: "undone", canUndo: false });
  });

  it("keeps the current URL source unchanged when the saved source revision drifts after preview", async () => {
    const fixture = await makeFixture();
    const web = new WebSourceRefreshService(vaultPort(fixture), {
      fetchSnapshot: async () => ({
        originalUrl: fixture.url,
        finalUrl: fixture.url,
        contentType: "text/plain",
        rawContent: "remote replacement",
        extractedText: "remote replacement",
        warnings: []
      })
    });
    const service = new SourceRefreshService(fixture.port, new DocumentParserService(), undefined, undefined, web);
    const preview = await service.preview(request(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed preview");
    const current = readRecord(fixture);
    writeRecord(fixture, { ...current, updatedAt: "2026-08-01T12:30:00.000Z" });

    await expect(service.confirm({ ...request(fixture), requestId: "sourcerefreshreq_driftweb123456",
      previewId: preview.preview.previewId, expectedSourceRevision: preview.preview.expectedSourceRevision }, () => true))
      .resolves.toMatchObject({ status: "stale" });
    expect(fs.readFileSync(path.join(fixture.vaultPath, current.managedCopy!.path), "utf8"))
      .toContain("Original evidence.");
    expect(findFiles(path.join(fixture.vaultPath, ".pige", "operations"), ".json")).toHaveLength(0);
  });

  it("adopts a ready refresh receipt after restart without fetching the URL again", async () => {
    const fixture = await makeFixture();
    const snapshot = { originalUrl: fixture.url, finalUrl: fixture.url, contentType: "text/plain",
      rawContent: "restart-ready evidence", extractedText: "restart-ready evidence", warnings: [] } as const;
    const web = new WebSourceRefreshService(vaultPort(fixture), { fetchSnapshot: async () => snapshot });
    const service = new SourceRefreshService(fixture.port, new DocumentParserService(), undefined, undefined, web);
    const preview = await service.preview(request(fixture), () => true);
    if (preview.status !== "changed") throw new Error("Expected changed preview");
    const result = await service.confirm({ ...request(fixture), requestId: "sourcerefreshreq_restartweb123",
      previewId: preview.preview.previewId, expectedSourceRevision: preview.preview.expectedSourceRevision }, () => true);
    if (result.status !== "refreshed") throw new Error("Expected refreshed result");
    const receiptPath = path.join(fixture.vaultPath, ".pige", "private", "web-source-refresh-receipts",
      result.operationId, "receipt.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(receiptPath, `${JSON.stringify({ ...receipt, state: "ready" }, null, 2)}\n`, "utf8");
    fs.rmSync(operationPath(fixture.vaultPath, result.operationId));

    let fetchCalls = 0;
    const restartedWeb = new WebSourceRefreshService(vaultPort(fixture), {
      fetchSnapshot: async () => { fetchCalls += 1; throw new Error("Recovery must not fetch"); }
    });
    const restarted = new SourceRefreshService(fixture.port, new DocumentParserService(), undefined, undefined, restartedWeb);
    expect(restarted.recoverIncompleteOperations()).toMatchObject({ recovered: 1, failed: 0 });
    expect(fetchCalls).toBe(0);
    expect(readOperation(fixture.vaultPath, result.operationId)).toMatchObject({ id: result.operationId });
    expect(JSON.parse(fs.readFileSync(receiptPath, "utf8"))).toMatchObject({ state: "applied" });
  });
});

async function makeFixture(): Promise<{
  readonly root: string;
  readonly vaultPath: string;
  readonly vault: VaultSummary;
  readonly port: ReturnType<typeof vaultPort>;
  readonly sourceId: string;
  readonly url: string;
}> {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-web-refresh-")));
  roots.push(root);
  createVaultOnDisk({ parentDirectory: root, vaultName: "WebRefresh", appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"), now: new Date("2026-08-01T10:00:00.000Z") });
  const vaultPath = path.join(root, "WebRefresh");
  const vault = loadVaultSummary(vaultPath);
  const port = { current: () => vault, activeVaultPath: () => vaultPath };
  const url = "https://example.com/article";
  const jobId = "job_20260801_webrefresh01";
  const sourceId = "src_20260801_webrefresh01";
  const capture = new CaptureService(port, {
    fetchSnapshot: async () => ({ originalUrl: url, finalUrl: url, contentType: "text/html", title: "Original article",
      rawContent: "<html><body><main>Original evidence.</main></body></html>",
      extractedText: "Original evidence.", warnings: [] })
  });
  await capture.preserveUrlForAgentTurn({ url, inputKind: "pasted_url", userIntent: "capture", locale: "en" }, {
    jobId, sourceId, inputHash: digest(url)
  });
  const record = readRecord({ vaultPath, sourceId });
  new SourcePageService().createForSource(vaultPath, record, sourceRecordPath(vaultPath, sourceId), jobId, record);
  return { root, vaultPath, vault, port, sourceId, url };
}

function vaultPort(fixture: { readonly vault?: VaultSummary; readonly vaultPath: string }) {
  return { current: () => fixture.vault, activeVaultPath: () => fixture.vaultPath };
}

function request(fixture: { readonly vault: VaultSummary; readonly sourceId: string }) {
  return { apiVersion: 1 as const, requestId: "sourcerefreshreq_previewweb12345", activeVaultId: fixture.vault.vaultId,
    currentPageId: fixture.sourceId.replace(/^src_/u, "page_"), renderContextId: `notectx_${"a".repeat(32)}`,
    sourceId: fixture.sourceId };
}

function sourceRecordPath(vaultPath: string, sourceId: string): string {
  const date = /^src_(\d{8})_/u.exec(sourceId)![1]!;
  return path.join(vaultPath, ".pige", "source-records", date.slice(0, 4), date.slice(4, 6), `${sourceId}.json`);
}

function readRecord(fixture: { readonly vaultPath: string; readonly sourceId: string }): SourceRecord {
  return JSON.parse(fs.readFileSync(sourceRecordPath(fixture.vaultPath, fixture.sourceId), "utf8")) as SourceRecord;
}

function writeRecord(fixture: { readonly vaultPath: string; readonly sourceId: string }, record: SourceRecord): void {
  fs.writeFileSync(sourceRecordPath(fixture.vaultPath, fixture.sourceId), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

function readOperation(vaultPath: string, operationId: string) {
  return OperationRecordSchema.parse(JSON.parse(fs.readFileSync(operationPath(vaultPath, operationId), "utf8")));
}

function operationPath(vaultPath: string, operationId: string): string {
  return findFiles(path.join(vaultPath, ".pige", "operations"), `${operationId}.json`)[0]!;
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(target, suffix) : entry.isFile() && entry.name.endsWith(suffix) ? [target] : [];
  });
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
