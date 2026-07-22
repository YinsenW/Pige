import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CaptureService,
  type AgentTurnFilePreservationBinding,
  type AgentTurnUrlPreservationBinding,
  type SourceFetchPort
} from "../../apps/desktop/src/main/services/capture-service";
import {
  createVaultOnDisk,
  loadVaultSummary,
  updateVaultSourceStorageStrategy
} from "../../apps/desktop/src/main/services/vault-layout";
import { verifyReadableSourceFile } from "../../apps/desktop/src/main/services/source-file-access";
import type { SourceRecord } from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";

const tempRoots: string[] = [];
let bindingSequence = 0;

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

function nextFileBinding(): AgentTurnFilePreservationBinding {
  bindingSequence += 1;
  const suffix = `binding${String(bindingSequence).padStart(3, "0")}`;
  return {
    jobId: `job_20260722_${suffix}`,
    sourceId: `src_20260722_${suffix}`
  };
}

function urlBinding(url: string): AgentTurnUrlPreservationBinding {
  const suffix = "urlbinding01";
  return {
    jobId: `job_20260722_${suffix}`,
    sourceId: `src_20260722_${suffix}`,
    inputHash: `sha256:${createHash("sha256").update(url, "utf8").digest("hex")}`
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Agent-turn source preservation", () => {
  it("preserves a bound Markdown source without creating a shadow Job or conversation event", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "research-note.md");
    const body = "# Research Note\n\nA local-first knowledge file.";
    fs.writeFileSync(sourcePath, body, "utf8");
    const binding = nextFileBinding();

    const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, binding);

    const record = readSourceRecord(vaultPath, binding.sourceId);
    expect(result).toMatchObject({
      status: "queued",
      sourceIds: [binding.sourceId],
      jobIds: [],
      conversationEventIds: [],
      rejectedFiles: []
    });
    expect(record).toMatchObject({
      id: binding.sourceId,
      kind: "markdown_file",
      semanticOrchestration: "agent_turn",
      metadata: { agentTurnJobId: binding.jobId }
    });
    expect(fs.readFileSync(path.join(vaultPath, record.managedCopy?.path ?? ""), "utf8")).toBe(body);
    expect(findFileOptional(path.join(vaultPath, ".pige/jobs"), ".json")).toBeUndefined();
    expect(findFileOptional(path.join(vaultPath, ".pige/conversations"), ".jsonl")).toBeUndefined();
  });

  it("requires one exact Agent-turn binding", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "one.md");
    fs.writeFileSync(sourcePath, "one", "utf8");

    await expect(makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath, sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    }, nextFileBinding())).rejects.toMatchObject({ code: "agent_runtime.turn_binding_invalid" });
  });

  it("honors reference-original storage for new file captures without creating a managed copy", async () => {
    const { vaultPath } = makeVault();
    const vault = updateVaultSourceStorageStrategy(vaultPath, "reference_original");
    const sourcePath = path.join(path.dirname(vaultPath), "referenced-note.md");
    const body = "# Referenced\n\nRead in place.";
    fs.writeFileSync(sourcePath, body, "utf8");
    const binding = nextFileBinding();

    await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(record.storageStrategy).toBe("reference_original");
    expect(record.managedCopy).toBeUndefined();
    expect(record.original?.path).toBe(sourcePath);
    expect(verifyReadableSourceFile(vaultPath, record)).toMatchObject({
      absolutePath: sourcePath,
      location: "referenced_original",
      size: Buffer.byteLength(body)
    });
  });

  it.each([
    ["paper.pdf", "pdf_file", "waiting_parser_or_ocr", true],
    ["records.csv", "csv_file", "waiting_agent_dataset_tool", false],
    ["archive.sqlite", "sqlite_file", "waiting_agent_dataset_tool", false]
  ] as const)("projects %s as a Pi-selectable typed source", async (name, kind, parserStatus, parserRequired) => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), name);
    fs.writeFileSync(sourcePath, name.endsWith(".sqlite") ? Buffer.from("SQLite format 3\0") : "fixture");
    const binding = nextFileBinding();

    await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(record.kind).toBe(kind);
    expect(record.metadata).toMatchObject({ parserStatus, parserRequired });
    if (!parserRequired) expect(record.metadata.datasetToolAvailable).toBe(true);
  });

  it.each(["-journal", "-wal", "-shm"])(
    "rejects a managed SQLite source with a live %s sidecar before durable writes",
    async (sidecarSuffix) => {
      const { vaultPath, vault } = makeVault();
      const sourcePath = path.join(path.dirname(vaultPath), "live.sqlite");
      fs.writeFileSync(sourcePath, Buffer.from("SQLite format 3\0"));
      fs.writeFileSync(`${sourcePath}${sidecarSuffix}`, "live-sidecar", "utf8");

      const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
        filePaths: [sourcePath],
        inputKind: "file_picker",
        userIntent: "capture",
        locale: "en"
      }, nextFileBinding());

      expect(result).toMatchObject({
        status: "rejected",
        sourceIds: [],
        jobIds: [],
        conversationEventIds: [],
        rejectedFiles: [{ displayName: "live.sqlite", reason: "copy_failed" }]
      });
      expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), ".json")).toBeUndefined();
    }
  );

  it("preserves a bound URL snapshot and extracted artifact without a shadow Job", async () => {
    const { vaultPath, vault } = makeVault();
    const url = "https://example.com/article";
    const binding = urlBinding(url);
    const service = makeService(vaultPath, vault, {
      fetchSnapshot: async () => ({
        originalUrl: url,
        finalUrl: url,
        contentType: "text/html",
        title: "Captured Web Page",
        rawContent: "<html><body><p>Readable web body.</p></body></html>",
        extractedText: "Readable web body.",
        warnings: ["instruction_like_source_text"]
      })
    });

    const result = await service.preserveUrlForAgentTurn({
      url,
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: "en"
    }, binding);
    const record = readSourceRecord(vaultPath, binding.sourceId);

    expect(result).toMatchObject({ sourceId: binding.sourceId, displayName: "Captured Web Page" });
    expect(record).toMatchObject({
      kind: "url",
      semanticOrchestration: "agent_turn",
      metadata: {
        agentTurnJobId: binding.jobId,
        agentTurnUrlInputHash: binding.inputHash
      }
    });
    const extracted = record.artifacts.find((artifact) => artifact.kind === "extracted_text");
    expect(fs.readFileSync(path.join(vaultPath, extracted?.path ?? ""), "utf8")).toBe("Readable web body.");
    expect(findFileOptional(path.join(vaultPath, ".pige/jobs"), ".json")).toBeUndefined();
  });

  it("rejects unsupported files without creating a source record", async () => {
    const { vaultPath, vault } = makeVault();
    const sourcePath = path.join(path.dirname(vaultPath), "archive.zip");
    fs.writeFileSync(sourcePath, "zip-placeholder", "utf8");

    const result = await makeService(vaultPath, vault).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    }, nextFileBinding());

    expect(result).toMatchObject({
      status: "rejected",
      sourceIds: [],
      rejectedFiles: [{ displayName: "archive.zip", reason: "unsupported_type" }]
    });
    expect(findFileOptional(path.join(vaultPath, ".pige/source-records"), ".json")).toBeUndefined();
  });
});

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord {
  return JSON.parse(fs.readFileSync(
    findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`),
    "utf8"
  )) as SourceRecord;
}

function findFile(root: string, suffix: string): string {
  const found = findFileOptional(root, suffix);
  if (!found) throw new Error(`Missing file ending with ${suffix}`);
  return found;
}

function findFileOptional(root: string, suffix: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) return fullPath;
  }
  return undefined;
}
