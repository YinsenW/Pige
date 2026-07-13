import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CaptureService, type SourceFetchPort } from "../../apps/desktop/src/main/services/capture-service";
import {
  createVaultOnDisk,
  loadVaultSummary,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";
import { verifyReadableSourceFile } from "../../apps/desktop/src/main/services/source-file-access";
import type { SourceRecord } from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-capture-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Capture",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Capture");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeService(vaultPath: string, vault: VaultSummary, sourceFetch?: SourceFetchPort): CaptureService {
  return new CaptureService({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, sourceFetch);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("capture service", () => {
  it("preserves text capture as a managed source, source record, conversation event, and queued job", () => {
    const { vaultPath, vault } = makeVault();
    const result = makeService(vaultPath, vault).submitText({
      text: "A durable note from the composer.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });

    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${result.sourceId}.json`);
    const jobRecordPath = findFile(path.join(vaultPath, ".pige/jobs"), `${result.jobId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      managedCopy: { path: string; checksum: string; size: number };
      metadata: { captureId: string; locale: string };
    };
    const jobRecord = JSON.parse(fs.readFileSync(jobRecordPath, "utf8")) as { state: string; sourceId: string };
    const managedText = fs.readFileSync(path.join(vaultPath, sourceRecord.managedCopy.path), "utf8");
    const conversationLog = fs.readFileSync(findFile(path.join(vaultPath, ".pige/conversations"), ".jsonl"), "utf8");

    expect(result.status).toBe("queued");
    expect(sourceRecord.metadata.captureId).toBe(result.captureId);
    expect(sourceRecord.metadata.locale).toBe("en");
    expect(sourceRecord.managedCopy.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(sourceRecord.managedCopy.size).toBe(Buffer.byteLength(managedText));
    expect(managedText).toBe("A durable note from the composer.");
    expect(conversationLog).toContain(result.sourceId);
    expect(conversationLog).toContain("A durable note from the composer.");
    expect(jobRecord).toMatchObject({ state: "queued", sourceId: result.sourceId });
  });

  it("stores large pasted text once and references it from conversation history", () => {
    const { vaultPath, vault } = makeVault();
    const largeText = "large-source-body\n".repeat(200);
    const result = makeService(vaultPath, vault).submitText({
      text: largeText,
      inputKind: "pasted_text",
      userIntent: "capture",
      locale: "en"
    });

    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${result.sourceId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as { managedCopy: { path: string } };
    const managedText = fs.readFileSync(path.join(vaultPath, sourceRecord.managedCopy.path), "utf8");
    const conversationLog = fs.readFileSync(findFile(path.join(vaultPath, ".pige/conversations"), ".jsonl"), "utf8");

    expect(managedText).toBe(largeText);
    expect(conversationLog).toContain(result.sourceId);
    expect(conversationLog).toContain("textPreview");
    expect(conversationLog).not.toContain(largeText);
  });

  it("preserves dropped Markdown files as managed source copies without duplicating file bodies in conversation history", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "research-note.md");
    const markdownBody = "# Research Note\n\nA local-first knowledge file.";
    fs.writeFileSync(sourcePath, markdownBody, "utf8");

    const result = await makeService(vaultPath, vault).submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    const sourceId = requireFirst(result.sourceIds);
    const jobId = requireFirst(result.jobIds);
    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`);
    const jobRecordPath = findFile(path.join(vaultPath, ".pige/jobs"), `${jobId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      kind: string;
      original: { path: string; displayName: string; checksum: string };
      managedCopy: { path: string; checksum: string; size: number };
    };
    const jobRecord = JSON.parse(fs.readFileSync(jobRecordPath, "utf8")) as { state: string; sourceId: string };
    const managedMarkdown = fs.readFileSync(path.join(vaultPath, sourceRecord.managedCopy.path), "utf8");
    const conversationLog = fs.readFileSync(findFile(path.join(vaultPath, ".pige/conversations"), ".jsonl"), "utf8");

    expect(result.status).toBe("queued");
    expect(result.rejectedFiles).toHaveLength(0);
    expect(sourceRecord.kind).toBe("markdown_file");
    expect(sourceRecord.original.displayName).toBe("research-note.md");
    expect(sourceRecord.original.path).toBe(sourcePath);
    expect(sourceRecord.original.checksum).toBe(sourceRecord.managedCopy.checksum);
    expect(sourceRecord.managedCopy.size).toBe(Buffer.byteLength(markdownBody));
    expect(managedMarkdown).toBe(markdownBody);
    expect(conversationLog).toContain("research-note.md");
    expect(conversationLog).toContain(sourceId);
    expect(conversationLog).not.toContain(markdownBody);
    expect(jobRecord).toMatchObject({ state: "queued", sourceId });
  });

  it("honors reference-original storage for new file captures without creating a managed copy", async () => {
    const { vaultPath } = makeVault();
    const vault = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const sourcePath = path.join(path.dirname(vaultPath), "referenced-note.md");
    const body = "# Referenced\n\nRead in place without duplicating the original.";
    fs.writeFileSync(sourcePath, body, "utf8");

    const result = await makeService(vaultPath, vault).submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(result.sourceIds);
    const record = JSON.parse(fs.readFileSync(
      findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`),
      "utf8"
    )) as SourceRecord;

    expect(record.storageStrategy).toBe("reference_original");
    expect(record.managedCopy).toBeUndefined();
    expect(record.original?.path).toBe(sourcePath);
    expect(verifyReadableSourceFile(vaultPath, record)).toMatchObject({
      absolutePath: sourcePath,
      location: "referenced_original",
      size: Buffer.byteLength(body)
    });
    expect(findFileOptional(path.join(vaultPath, "raw"), `${sourceId}.md`)).toBeUndefined();
  });

  it("preserves document and image files as managed sources for later parser or OCR work", async () => {
    const { vaultPath, vault } = makeVault();
    const parent = path.dirname(vaultPath);
    const files = [
      { name: "paper.pdf", body: Buffer.from("%PDF-1.7\nbinary-ish") },
      { name: "brief.docx", body: Buffer.from("PK\u0003\u0004docx") },
      { name: "deck.pptx", body: Buffer.from("PK\u0003\u0004pptx") },
      { name: "scan.png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
    ];
    const filePaths = files.map((file) => {
      const filePath = path.join(parent, file.name);
      fs.writeFileSync(filePath, file.body);
      return filePath;
    });

    const result = await makeService(vaultPath, vault).submitFiles({
      filePaths,
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    expect(result.status).toBe("queued");
    expect(result.rejectedFiles).toHaveLength(0);
    expect(result.sourceIds).toHaveLength(4);
    const sourceRecords = result.sourceIds.map((sourceId) =>
      JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`), "utf8")) as {
        kind: string;
        original: { displayName: string };
        managedCopy: { path: string; checksum: string; size: number };
        metadata: { parserStatus: string; parserRequired: boolean };
      }
    );

    expect(sourceRecords.map((record) => record.kind).sort()).toEqual([
      "docx_file",
      "image_file",
      "pdf_file",
      "pptx_file"
    ]);
    for (const record of sourceRecords) {
      expect(record.metadata).toMatchObject({ parserStatus: "waiting_parser_or_ocr", parserRequired: true });
      expect(record.managedCopy.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(fs.existsSync(path.join(vaultPath, record.managedCopy.path))).toBe(true);
    }
    const conversationLog = fs.readFileSync(findFile(path.join(vaultPath, ".pige/conversations"), ".jsonl"), "utf8");
    expect(conversationLog).toContain("paper.pdf");
    expect(conversationLog).toContain("scan.png");
    expect(conversationLog).not.toContain("%PDF-1.7");
  });

  it("preserves structured files for Agent-selected Dataset materialization without host parsing", async () => {
    const { vaultPath, vault } = makeVault();
    const parent = path.dirname(vaultPath);
    const files = [
      { name: "records.csv", body: Buffer.from("name,count\nAda,3\n", "utf8") },
      { name: "workbook.xlsx", body: Buffer.from("PK\u0003\u0004xlsx") },
      { name: "archive.sqlite", body: Buffer.from("SQLite format 3\u0000") }
    ];
    const filePaths = files.map((file) => {
      const filePath = path.join(parent, file.name);
      fs.writeFileSync(filePath, file.body);
      return filePath;
    });

    const result = await makeService(vaultPath, vault).submitFiles({
      filePaths,
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    expect(result.status).toBe("queued");
    expect(result.rejectedFiles).toHaveLength(0);
    const sourceRecords = result.sourceIds.map((sourceId) =>
      JSON.parse(fs.readFileSync(findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`), "utf8")) as {
        kind: string;
        metadata: { datasetToolAvailable: boolean; parserRequired: boolean; parserStatus: string };
      }
    );

    expect(sourceRecords.map((record) => record.kind).sort()).toEqual([
      "csv_file",
      "sqlite_file",
      "xlsx_file"
    ]);
    for (const record of sourceRecords) {
      expect(record.metadata).toEqual(expect.objectContaining({
        datasetToolAvailable: true,
        parserRequired: false,
        parserStatus: "waiting_agent_dataset_tool"
      }));
    }
  });

  it.each(["-journal", "-wal", "-shm"])(
    "rejects managed SQLite capture with a live %s sidecar before durable writes",
    async (sidecarSuffix) => {
      const { vaultPath, vault } = makeVault();
      const sourcePath = path.join(path.dirname(vaultPath), "live.sqlite");
      const sourceBody = Buffer.from("SQLite format 3\u0000");
      const sidecarBody = `synthetic live SQLite sidecar ${sidecarSuffix}`;
      fs.writeFileSync(sourcePath, sourceBody);
      fs.writeFileSync(`${sourcePath}${sidecarSuffix}`, sidecarBody, "utf8");

      const result = await makeService(vaultPath, vault).submitFiles({
        filePaths: [sourcePath],
        inputKind: "file_picker",
        userIntent: "capture",
        locale: "en"
      });

      expect(result.status).toBe("rejected");
      expect(result.sourceIds).toEqual([]);
      expect(result.jobIds).toEqual([]);
      expect(result.conversationEventIds).toEqual([]);
      expect(result.rejectedFiles).toEqual([{ displayName: "live.sqlite", reason: "copy_failed" }]);
      expect(findFileOptional(path.join(vaultPath, "raw"), ".sqlite")).toBeUndefined();
      expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), ".json")).toBeUndefined();
      expect(findFileOptional(path.join(vaultPath, ".pige/jobs"), ".json")).toBeUndefined();
      expect(findFileOptional(path.join(vaultPath, ".pige/conversations"), ".jsonl")).toBeUndefined();
      expect(fs.readFileSync(sourcePath)).toEqual(sourceBody);
      expect(fs.readFileSync(`${sourcePath}${sidecarSuffix}`, "utf8")).toBe(sidecarBody);
    }
  );

  it("retains live SQLite sidecar metadata when capture references the original", async () => {
    const { vaultPath } = makeVault();
    const vault = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const sourcePath = path.join(path.dirname(vaultPath), "live-reference.sqlite");
    fs.writeFileSync(sourcePath, Buffer.from("SQLite format 3\u0000"));
    fs.writeFileSync(`${sourcePath}-wal`, "synthetic uncheckpointed WAL", "utf8");

    const result = await makeService(vaultPath, vault).submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(result.sourceIds);
    const source = JSON.parse(fs.readFileSync(
      findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`),
      "utf8"
    )) as SourceRecord;

    expect(result.status).toBe("queued");
    expect(result.rejectedFiles).toEqual([]);
    expect(source.storageStrategy).toBe("reference_original");
    expect(source.metadata.sqliteLiveSidecars).toEqual(["-wal"]);
    expect(source.managedCopy).toBeUndefined();
    expect(source.original?.path).toBe(sourcePath);
    expect(findFileOptional(path.join(vaultPath, "raw"), ".sqlite")).toBeUndefined();
  });

  it("preserves URL captures as raw web snapshots plus extracted text without duplicating bodies in conversation history", async () => {
    const { vaultPath, vault } = makeVault();
    const secretUrl = "https://example.com/article?token=secret-token&view=full";
    const result = await makeService(vaultPath, vault, {
      fetchSnapshot: async () => ({
        originalUrl: secretUrl,
        finalUrl: "https://example.com/article?token=secret-token&view=full#ignored",
        canonicalUrl: "https://example.com/canonical?api_key=secret-key",
        contentType: "text/html",
        charset: "utf-8",
        title: "Captured Web Page",
        byline: "Ada Example",
        siteName: "Example Notes",
        language: "en",
        publishedTime: "2026-07-08T10:30:00Z",
        excerpt: "A representative article excerpt.",
        imageReferences: [
          "https://cdn.example.com/cover.png?signature=image-secret#fragment",
          "javascript:alert(1)"
        ],
        extraction: {
          parserId: "mozilla_readability",
          engine: "@mozilla/readability+jsdom",
          version: "0.6.0+29.1.1",
          mode: "readability",
          textCharacterCount: 18,
          elementCount: 42,
          truncated: false
        },
        rawContent: "<html><body><script>ignore()</script><p>Readable web body.</p></body></html>",
        extractedText: "Readable web body.",
        warnings: ["instruction_like_source_text"]
      })
    }).submitUrl({
      url: secretUrl,
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: "en"
    });

    const sourceRecordPath = findFile(path.join(vaultPath, ".pige/source-records"), `${result.sourceId}.json`);
    const jobRecordPath = findFile(path.join(vaultPath, ".pige/jobs"), `${result.jobId}.json`);
    const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
      kind: string;
      original: { uri: string; displayName: string };
      managedCopy: { path: string; checksum: string; size: number };
      artifacts: readonly { kind: string; path: string }[];
      metadata: {
        originalUrl: string;
        finalUrl: string;
        canonicalUrl: string;
        title: string;
        charset: string;
        byline: string;
        siteName: string;
        sourceLanguage: string;
        publishedTime: string;
        excerpt: string;
        imageReferences: readonly string[];
        extractionWarnings: readonly string[];
        webExtraction: { parserId: string; engine: string; version: string; mode: string; elementCount: number };
      };
    };
    const rawSnapshot = fs.readFileSync(path.join(vaultPath, sourceRecord.managedCopy.path), "utf8");
    const extractedText = fs.readFileSync(path.join(vaultPath, requireFirst(sourceRecord.artifacts).path), "utf8");
    const conversationLog = fs.readFileSync(findFile(path.join(vaultPath, ".pige/conversations"), ".jsonl"), "utf8");
    const jobRecord = JSON.parse(fs.readFileSync(jobRecordPath, "utf8")) as { state: string; sourceId: string };

    expect(result.status).toBe("queued");
    expect(sourceRecord.kind).toBe("url");
    expect(sourceRecord.original.displayName).toBe("Captured Web Page");
    expect(sourceRecord.original.uri).toContain("token=%5Bredacted%5D");
    expect(sourceRecord.metadata.finalUrl).toContain("token=%5Bredacted%5D");
    expect(sourceRecord.metadata.canonicalUrl).toContain("api_key=%5Bredacted%5D");
    expect(sourceRecord.metadata).toMatchObject({
      charset: "utf-8",
      byline: "Ada Example",
      siteName: "Example Notes",
      sourceLanguage: "en",
      publishedTime: "2026-07-08T10:30:00Z",
      excerpt: "A representative article excerpt.",
      extractionWarnings: ["instruction_like_source_text"],
      webExtraction: {
        parserId: "mozilla_readability",
        engine: "@mozilla/readability+jsdom",
        version: "0.6.0+29.1.1",
        mode: "readability",
        elementCount: 42
      }
    });
    expect(sourceRecord.metadata.imageReferences).toEqual([
      "https://cdn.example.com/cover.png?signature=%5Bredacted%5D"
    ]);
    expect(JSON.stringify(sourceRecord)).not.toContain("secret-token");
    expect(JSON.stringify(sourceRecord)).not.toContain("secret-key");
    expect(JSON.stringify(sourceRecord)).not.toContain("image-secret");
    expect(JSON.stringify(sourceRecord)).not.toContain("javascript:");
    expect(rawSnapshot).toContain("<script>ignore()</script>");
    expect(extractedText).toBe("Readable web body.");
    expect(conversationLog).toContain(result.sourceId);
    expect(conversationLog).toContain("Captured Web Page");
    expect(conversationLog).not.toContain("Readable web body.");
    expect(conversationLog).not.toContain("secret-token");
    expect(jobRecord).toMatchObject({ state: "queued", sourceId: result.sourceId });
  });

  it("rejects unsupported dropped files without creating source records", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "archive.zip");
    fs.writeFileSync(sourcePath, "zip-placeholder", "utf8");

    const result = await makeService(vaultPath, vault).submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });

    expect(result.status).toBe("rejected");
    expect(result.sourceIds).toHaveLength(0);
    expect(result.rejectedFiles).toEqual([{ displayName: "archive.zip", reason: "unsupported_type" }]);
    expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), ".json")).toBeUndefined();
  });
});

function findFile(root: string, suffix: string): string {
  const found = findFileOptional(root, suffix);
  if (!found) throw new Error(`Missing file ending with ${suffix}`);
  return found;
}

function findFileOptional(root: string, suffix: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return undefined;
}

function requireFirst<T>(values: readonly T[]): T {
  const first = values[0];
  if (!first) throw new Error("Expected at least one value.");
  return first;
}
