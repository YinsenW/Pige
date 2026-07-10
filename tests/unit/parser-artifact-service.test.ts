import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeParserService, type OfficeTextExtractor } from "../../apps/desktop/src/main/services/office-parser-service";
import {
  OFFICE_PARSER_ENGINE,
  OFFICE_PARSER_ID,
  OFFICE_PARSER_VERSION,
  type OfficeExtractionResult
} from "../../apps/desktop/src/main/services/office-parser-types";
import { ParserArtifactService } from "../../apps/desktop/src/main/services/parser-artifact-service";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";
import { JobRecordSchema, SourceRecordSchema, type SourceRecord } from "@pige/schemas";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("parser artifact service", () => {
  it("reuses verified artifacts and regenerates an artifact whose checksum changed", async () => {
    const fixture = makeFixture();
    const extractor = new StaticOfficeExtractor();
    const service = new OfficeParserService(extractor);

    const first = await service.parseSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    );
    const afterFirst = readSourceRecord(fixture);
    const second = await service.parseSource(
      fixture.vaultPath,
      afterFirst,
      fixture.sourceRecordPath,
      fixture.job
    );
    const textArtifact = requireValue(afterFirst.artifacts.find((artifact) => artifact.kind === "extracted_text"));
    const textArtifactPath = path.join(fixture.vaultPath, textArtifact.path);
    fs.appendFileSync(textArtifactPath, "tampered", "utf8");
    const third = await service.parseSource(
      fixture.vaultPath,
      afterFirst,
      fixture.sourceRecordPath,
      fixture.job
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(third.created).toBe(true);
    expect(extractor.callCount).toBe(2);
    expect(fs.readFileSync(textArtifactPath, "utf8")).toBe(`${extractor.result.text}\n`);
  });

  it("binds Office extraction to a private snapshot across a live pathname replacement", async () => {
    const fixture = makeFixture();
    const result = new StaticOfficeExtractor().result;
    let snapshotPath: string | undefined;
    let observedInput = Buffer.alloc(0);
    const service = new OfficeParserService({
      extract: async (filePath) => {
        snapshotPath = filePath;
        const displacedPath = `${fixture.sourceAbsolutePath}.displaced`;
        fs.renameSync(fixture.sourceAbsolutePath, displacedPath);
        fs.writeFileSync(fixture.sourceAbsolutePath, Buffer.from("replacement bytes at the recorded source pathname"));
        try {
          observedInput = fs.readFileSync(filePath);
          return result;
        } finally {
          fs.rmSync(fixture.sourceAbsolutePath, { force: true });
          fs.renameSync(displacedPath, fixture.sourceAbsolutePath);
        }
      }
    });

    await service.parseSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    );

    const capturedSnapshotPath = requireValue(snapshotPath);
    expect(capturedSnapshotPath).not.toBe(fixture.sourceAbsolutePath);
    expect(observedInput).toEqual(fixture.sourceBytes);
    expect(fs.existsSync(capturedSnapshotPath)).toBe(false);
    expect(fs.readFileSync(fixture.sourceAbsolutePath)).toEqual(fixture.sourceBytes);
  });

  it("deletes the private Office snapshot when extraction fails", async () => {
    const fixture = makeFixture();
    let snapshotPath: string | undefined;
    const service = new OfficeParserService({
      extract: async (filePath) => {
        snapshotPath = filePath;
        throw new Error("simulated Office worker failure");
      }
    });

    await expect(service.parseSource(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job
    )).rejects.toThrow("simulated Office worker failure");

    const capturedSnapshotPath = requireValue(snapshotPath);
    expect(capturedSnapshotPath).not.toBe(fixture.sourceAbsolutePath);
    expect(fs.existsSync(capturedSnapshotPath)).toBe(false);
  });

  it("rejects adapter metadata that attempts to overwrite parser-owned provenance", () => {
    const fixture = makeFixture();
    const artifacts = new ParserArtifactService();

    expect(() => artifacts.persist(
      fixture.vaultPath,
      fixture.sourceRecord,
      fixture.sourceRecordPath,
      fixture.job,
      {
        format: "docx",
        parser: { id: OFFICE_PARSER_ID, engine: OFFICE_PARSER_ENGINE, version: OFFICE_PARSER_VERSION },
        text: "Verified extraction",
        textCharacterCount: "Verified extraction".length,
        textCoverage: "medium",
        truncated: false,
        needsOcr: false,
        agentTextReady: true,
        ocrCandidateLocators: [],
        sidecarMetadata: { sourceId: "src_20260710_override" },
        sourceMetadata: {},
        warnings: []
      }
    )).toThrow("reserved sidecar metadata key");
  });
});

class StaticOfficeExtractor implements OfficeTextExtractor {
  callCount = 0;
  readonly result: OfficeExtractionResult = {
    parserId: OFFICE_PARSER_ID,
    engine: OFFICE_PARSER_ENGINE,
    engineVersion: OFFICE_PARSER_VERSION,
    format: "docx",
    title: "Verified Office fixture",
    text: "Verified Office extraction with enough local text for Agent ingest.",
    textCharacterCount: "Verified Office extraction with enough local text for Agent ingest.".length,
    textCoverage: "medium",
    truncated: false,
    needsOcr: false,
    agentTextReady: true,
    ocrCandidateLocators: [],
    unitCount: 1,
    processedUnitCount: 1,
    unitsWithText: 1,
    units: [{
      index: 1,
      locator: "block:1",
      kind: "paragraph",
      characterStart: 0,
      characterEnd: 65,
      characterCount: 65,
      imageCount: 0,
      needsOcr: false,
      warnings: []
    }],
    entryCount: 2,
    totalUncompressedBytes: 256,
    mediaReferences: [],
    structure: { paragraphCount: 1 },
    warnings: []
  };

  async extract(): Promise<OfficeExtractionResult> {
    this.callCount += 1;
    return this.result;
  }
}

function makeFixture(): {
  readonly vaultPath: string;
  readonly sourceRecord: SourceRecord;
  readonly sourceRecordPath: string;
  readonly sourceAbsolutePath: string;
  readonly sourceBytes: Buffer;
  readonly job: ReturnType<typeof JobRecordSchema.parse>;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-parser-artifact-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Artifacts",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Artifacts");
  const managedPath = "raw/files/2026/07/src_20260710_artifact01.docx";
  const managedBytes = Buffer.from("preserved fake DOCX bytes");
  writeVaultFile(vaultPath, managedPath, managedBytes);
  const sourceAbsolutePath = path.join(vaultPath, managedPath);
  const sourceRecordPath = ".pige/source-records/2026/07/src_20260710_artifact01.json";
  const sourceRecord = SourceRecordSchema.parse({
    id: "src_20260710_artifact01",
    kind: "docx_file",
    storageStrategy: "copy_to_source_library",
    managedCopy: {
      path: managedPath,
      checksum: checksumBuffer(managedBytes),
      size: managedBytes.length
    },
    artifacts: [],
    metadata: { parserRequired: true, parserStatus: "waiting_parser_or_ocr" },
    createdAt: "2026-07-10T01:00:00.000Z",
    updatedAt: "2026-07-10T01:00:00.000Z"
  });
  writeVaultFile(vaultPath, sourceRecordPath, Buffer.from(`${JSON.stringify(sourceRecord, null, 2)}\n`));
  const job = JobRecordSchema.parse({
    id: "job_20260710_artifact01",
    class: "parse",
    state: "running",
    createdAt: "2026-07-10T01:00:00.000Z",
    updatedAt: "2026-07-10T01:00:00.000Z",
    sourceId: sourceRecord.id,
    message: "Fixture parser running."
  });
  return {
    vaultPath,
    sourceRecord,
    sourceRecordPath,
    sourceAbsolutePath,
    sourceBytes: managedBytes,
    job
  };
}

function readSourceRecord(fixture: { readonly vaultPath: string; readonly sourceRecordPath: string }): SourceRecord {
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(fixture.vaultPath, fixture.sourceRecordPath), "utf8")));
}

function writeVaultFile(vaultPath: string, relativePath: string, value: Buffer): void {
  const filePath = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value);
}

function checksumBuffer(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
