import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import type { DocumentParserPort } from "../../apps/desktop/src/main/services/document-parser-service";
import { JobsService, type JobsVaultPort } from "../../apps/desktop/src/main/services/jobs-service";
import { extractPdfText } from "../../apps/desktop/src/main/services/pdf-parser-core";
import { PdfParserService } from "../../apps/desktop/src/main/services/pdf-parser-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { createTestPdf } from "./helpers/pdf-fixture";

const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("document parse executor integration", { timeout: 15_000 }, () => {
  it("adopts one durable parser effect into the same Job after settlement CAS contention", async () => {
    const fixture = makeVault("ParseAdoption");
    const captured = await preservePdf(fixture, "adoption.pdf", "One durable parse effect survives Job settlement contention.");
    const parser = makePdfParser();
    let parserCalls = 0;
    const contendingParser: DocumentParserPort = {
      canParse: (kind) => parser.canParse(kind),
      parseSource: async (...args) => {
        parserCalls += 1;
        const result = await parser.parseSource(...args);
        const job = args[3];
        const jobPath = findFile(path.join(fixture.vaultPath, ".pige", "jobs"), `${job.id}.json`);
        const current = readJob(jobPath);
        writeJob(jobPath, JobRecordSchema.parse({
          ...current,
          state: "failed_retryable",
          updatedAt: "2026-07-26T04:02:00.000Z",
          finishedAt: "2026-07-26T04:02:00.000Z",
          retry: {
            retryCount: current.retry?.retryCount ?? 0,
            maxAutomaticRetries: 0,
            requiresUserAction: true,
            lastRetryReason: "synthetic_settlement_contention"
          },
          message: "Synthetic settlement winner retained the durable parser effect."
        }));
        return result;
      }
    };
    const jobs = new JobsService(fixture.vaultPort, undefined, undefined, contendingParser);

    expect(await jobs.documentParseExecutor().process({ jobIds: [captured.parseJobId] })).toMatchObject({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completed = readJob(findFile(
      path.join(fixture.vaultPath, ".pige", "jobs"),
      `${captured.parseJobId}.json`
    ));
    expect(completed).toMatchObject({
      id: captured.parseJobId,
      state: "completed",
      retry: { retryCount: 1, lastRetryReason: "parser_durable_output_adoption" },
      cancellation: { safeCheckpointId: "parser_artifacts_committed", durableWritesApplied: true },
      progress: { completedUnits: 1, totalUnits: 1, unit: "document" }
    });
    expect(completed.outputRefs?.map((ref) => ref.kind)).toEqual(["artifact", "artifact"]);
    expect(completed.outputRefs?.every((ref) => ref.checksum?.startsWith("sha256:") === true)).toBe(true);
    expect(completed.operationIds).toHaveLength(1);
    expect(parserCalls).toBe(1);
    expect(findFiles(path.join(fixture.vaultPath, ".pige", "operations"), ".json")).toHaveLength(1);
  });

  it("keeps an agent_turn-owned parse child behind the startup barrier across restart", async () => {
    const fixture = makeVault("ParseRestart");
    const captured = await preservePdf(fixture, "restart.pdf", "The parent resumes this exact queued parse child.");
    const parent = JobRecordSchema.parse({
      id: "job_20260726_parseparent1",
      class: "agent_turn",
      state: "queued",
      childJobIds: [captured.parseJobId],
      createdAt: "2026-07-26T04:00:00.000Z",
      updatedAt: "2026-07-26T04:00:00.000Z",
      sourceId: captured.sourceId,
      message: "Parent owns parse execution order."
    });
    writeJob(jobPath(fixture.vaultPath, parent.id), parent);
    const childPath = findFile(path.join(fixture.vaultPath, ".pige", "jobs"), `${captured.parseJobId}.json`);
    writeJob(childPath, JobRecordSchema.parse({ ...readJob(childPath), parentJobId: parent.id }));
    let parserCalls = 0;
    const parser = makePdfParser(() => { parserCalls += 1; });

    const initial = new JobsService(fixture.vaultPort, undefined, undefined, parser);
    expect(await initial.documentParseExecutor().process({ limit: 20 })).toMatchObject({ processed: 0 });
    const restarted = new JobsService(fixture.vaultPort, undefined, undefined, parser);
    expect(await restarted.documentParseExecutor().process({ limit: 20 })).toMatchObject({ processed: 0 });
    expect(parserCalls).toBe(0);
    expect(readJob(childPath).state).toBe("queued");

    expect(await restarted.documentParseExecutor().process({
      jobIds: [captured.parseJobId],
      limit: 1
    })).toMatchObject({ processed: 1, completed: 1, failed: 0 });
    expect(parserCalls).toBe(1);
    expect(readJob(childPath)).toMatchObject({ id: captured.parseJobId, state: "completed" });
    expect(findFiles(path.join(fixture.vaultPath, ".pige", "jobs"), `${captured.parseJobId}.json`)).toHaveLength(1);
  });

  it("fails closed when the active vault changes after parse selection but before begin", async () => {
    const first = makeVault("ParseVaultA");
    const second = makeVault("ParseVaultB");
    const captured = await preservePdf(first, "binding.pdf", "Vault binding must remain exact before parser execution.");
    let active = first;
    let parserCalls = 0;
    const vaults: JobsVaultPort = {
      current: () => active.vault,
      activeVaultPath: () => active.vaultPath,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== active.vaultPath) {
          throw new PigeDomainError("vault.binding_changed", "The active vault changed before parse execution.");
        }
      }
    };
    const parser: DocumentParserPort = {
      canParse: () => {
        active = second;
        return true;
      },
      parseSource: async () => {
        parserCalls += 1;
        throw new Error("must not run");
      }
    };
    const jobs = new JobsService(vaults, undefined, undefined, parser);

    await expect(jobs.documentParseExecutor().process({ jobIds: [captured.parseJobId] }))
      .rejects.toMatchObject({ code: "vault.binding_changed" });
    expect(parserCalls).toBe(0);
    expect(readJob(findFile(
      path.join(first.vaultPath, ".pige", "jobs"),
      `${captured.parseJobId}.json`
    )).state).toBe("queued");
    expect(findFiles(path.join(second.vaultPath, ".pige", "jobs"), ".json")).toEqual([]);
  });
});

interface VaultFixture {
  readonly root: string;
  readonly vaultPath: string;
  readonly vault: VaultSummary;
  readonly vaultPort: JobsVaultPort;
}

function makeVault(name: string): VaultFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-parse-executor-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-26T04:00:00.000Z")
  });
  const vaultPath = path.join(root, name);
  const vault = loadVaultSummary(vaultPath);
  return {
    root,
    vaultPath,
    vault,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

async function preservePdf(
  fixture: VaultFixture,
  fileName: string,
  text: string
): Promise<{ readonly sourceId: string; readonly parseJobId: string }> {
  const sourcePath = path.join(fixture.root, fileName);
  fs.writeFileSync(sourcePath, createTestPdf([text]));
  const capture = new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath);
  const jobs = new JobsService(fixture.vaultPort);
  const accepted = await capture.submitFiles({
    filePaths: [sourcePath],
    inputKind: "file_drop",
    userIntent: "capture",
    locale: "en"
  });
  const sourceId = requireValue(accepted.sourceIds[0]);
  jobs.processQueuedCaptures({ jobIds: accepted.jobIds });
  return { sourceId, parseJobId: seedParseJob(fixture.vaultPath, sourceId).id };
}

function seedParseJob(vaultPath: string, sourceId: string): JobRecord {
  const parent = requireValue(readJobs(vaultPath).find((job) =>
    job.class === "capture" && job.sourceId === sourceId
  ));
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const child = JobRecordSchema.parse({
    id: `job_20260726_${suffix}pa`,
    class: "parse",
    state: "queued",
    parentJobId: parent.id,
    createdAt: "2026-07-26T04:01:00.000Z",
    updatedAt: "2026-07-26T04:01:00.000Z",
    sourceId,
    message: "Parse executor fixture queued."
  });
  writeJob(jobPath(vaultPath, child.id), child);
  return child;
}

function makePdfParser(onExtract?: () => void): PdfParserService {
  return new PdfParserService({
    isAvailable: () => true,
    extract: (filePath) => {
      onExtract?.();
      return extractPdfText({
        requestId: "parse-executor-test",
        filePath,
        limits: { maxBytes: 5 * 1024 * 1024, maxPages: 20 }
      });
    }
  });
}

function jobPath(vaultPath: string, jobId: string): string {
  const date = requireValue(/^job_(\d{8})_/u.exec(jobId)?.[1]);
  return path.join(vaultPath, ".pige", "jobs", date.slice(0, 4), date.slice(4, 6), `${jobId}.json`);
}

function writeJob(filePath: string, job: JobRecord): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

function readJob(filePath: string): JobRecord {
  return JobRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function readJobs(vaultPath: string): JobRecord[] {
  return findFiles(path.join(vaultPath, ".pige", "jobs"), ".json").map(readJob);
}

function findFile(root: string, suffix: string): string {
  return requireValue(findFiles(root, suffix)[0]);
}

function findFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? findFiles(target, suffix) : target.endsWith(suffix) ? [target] : [];
  });
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected value to exist.");
  return value;
}
