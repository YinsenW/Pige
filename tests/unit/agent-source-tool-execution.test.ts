import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import { SourceRecordSchema, type SourceRecord } from "@pige/schemas";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const tempRoots: string[] = [];
const HASH = `sha256:${"a".repeat(64)}`;

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent source tool execution port", () => {
  it("does not expose source tools to a text-only Agent turn", async () => {
    const fixture = makeFixture();
    const jobs = new JobsService(fixture.vaults);
    const job = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260722_textonly01",
      conversationLocator: ".pige/conversations/2026/07/conv_20260722.jsonl",
      inputHash: HASH
    });

    await jobs.runTextAgentTurn(job.id, async (execution) => {
      expect(execution.sourceTools).toBeUndefined();
    });
  });

  it("binds all source dispatchers to the active parent execution and its cancellation signal", async () => {
    const fixture = makeFixture();
    const jobs = new JobsService(fixture.vaults);
    const capture = new CaptureService(fixture.vaults);
    const sourcePath = path.join(fixture.root, "source.md");
    fs.writeFileSync(sourcePath, "# Source\n", "utf8");
    const job = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260722_source001",
      conversationLocator: ".pige/conversations/2026/07/conv_20260722.jsonl",
      inputHash: HASH,
      sourceExpected: true
    });
    const sourceId = requireValue(job.sourceId);
    await capture.preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: job.id, sourceId });
    jobs.attachAgentTurnSource(job.id, sourceId);
    const sourceRecord = readSourceRecord(fixture.vaultPath, sourceId);
    const unrelatedSignal = new AbortController().signal;

    await expect(jobs.runTextAgentTurn(job.id, async (execution) => {
      expect(execution.sourceTools).toEqual({
        parse: expect.any(Function),
        ocr: expect.any(Function),
        materializeDataset: expect.any(Function)
      });
      expect(execution.signal.aborted).toBe(false);
      expect(jobs.cancel({ jobId: job.id }).status).toBe("cancel_requested");
      expect(execution.signal.aborted).toBe(true);
      await requireValue(execution.sourceTools).parse({
        toolCallId: "call_source_parse_01",
        toolId: "pige_parse_source",
        toolVersion: "1",
        canonicalInputHash: HASH,
        catalogHash: HASH,
        policyHash: HASH,
        sourceRecord,
        signal: unrelatedSignal
      });
    })).rejects.toMatchObject({ code: "agent_runtime.turn_cancelled" });
  });
});

function makeFixture(): {
  readonly root: string;
  readonly vaultPath: string;
  readonly vaults: {
    readonly current: () => ReturnType<typeof loadVaultSummary>;
    readonly activeVaultPath: () => string;
  };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-source-tools-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "SourceTools",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-22T08:00:00.000Z")
  });
  const vaultPath = path.join(root, "SourceTools");
  const vault = loadVaultSummary(vaultPath);
  return {
    root,
    vaultPath,
    vaults: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

function readSourceRecord(vaultPath: string, sourceId: string): SourceRecord {
  const sourcesRoot = path.join(vaultPath, ".pige", "source-records");
  const recordPath = findFile(sourcesRoot, `${sourceId}.json`);
  if (!recordPath) throw new Error("Expected preserved source record.");
  return SourceRecordSchema.parse(JSON.parse(fs.readFileSync(recordPath, "utf8")));
}

function findFile(directory: string, fileName: string): string | undefined {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(candidate, fileName);
      if (nested) return nested;
    } else if (entry.isFile() && entry.name === fileName) {
      return candidate;
    }
  }
  return undefined;
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new PigeDomainError("unknown", "Expected fixture value.");
  return value;
}
