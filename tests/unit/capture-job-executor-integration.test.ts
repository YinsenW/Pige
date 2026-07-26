import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import { PigeDomainError } from "@pige/domain";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import { createJobClassExecutorRegistry } from "../../apps/desktop/src/main/services/job-class-executor-registry";
import { JobsService, type JobsVaultPort } from "../../apps/desktop/src/main/services/jobs-service";
import {
  SourcePageService,
  type SourcePageResult
} from "../../apps/desktop/src/main/services/source-page-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Capture executor integration", () => {
  it("adopts one durable source page into the same Job after settlement CAS contention", () => {
    const fixture = makeVault("CaptureAdoption");
    const captured = preserveText(fixture, "Capture adoption\n\nDurable source evidence.");
    let publicationCalls = 0;
    const sourcePages = new HookedSourcePageService(() => {
      publicationCalls += 1;
      const filePath = jobPath(fixture.vaultPath, captured.jobId);
      const current = readJob(filePath);
      writeJob(filePath, JobRecordSchema.parse({
        ...current,
        state: "failed_retryable",
        updatedAt: "2026-07-26T05:02:00.000Z",
        finishedAt: "2026-07-26T05:02:00.000Z",
        retry: {
          retryCount: current.retry?.retryCount ?? 0,
          maxAutomaticRetries: 0,
          requiresUserAction: true,
          lastRetryReason: "synthetic_settlement_contention"
        },
        message: "Synthetic settlement winner retained the durable source page."
      }));
    });
    const jobs = makeJobs(fixture.vaultPort, sourcePages);

    expect(jobs.captureExecutor().process({ jobIds: [captured.jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completed = readJob(jobPath(fixture.vaultPath, captured.jobId));
    expect(completed).toMatchObject({
      id: captured.jobId,
      state: "completed",
      retry: { retryCount: 1, lastRetryReason: "capture_durable_output_adoption" },
      cancellation: { safeCheckpointId: "capture_source_page_committed", durableWritesApplied: true },
      progress: { completedUnits: 1, totalUnits: 1, unit: "source" }
    });
    expect(completed.outputRefs).toEqual([
      expect.objectContaining({ kind: "source", id: captured.sourceId, role: "capture_source_record" }),
      expect.objectContaining({ kind: "page", role: "capture_source_page" })
    ]);
    expect(completed.outputRefs?.every((ref) => ref.checksum?.startsWith("sha256:") === true)).toBe(true);
    expect(publicationCalls).toBe(1);
    expect(findFiles(path.join(fixture.vaultPath, "sources"), ".md")).toHaveLength(1);
    expect(jobs.captureExecutor().process({ jobIds: [captured.jobId] })).toEqual({
      processed: 0,
      completed: 0,
      failed: 0
    });
  });

  it("restarts the same queued Capture Job without duplicating source identity", () => {
    const fixture = makeVault("CaptureRestart");
    const captured = preserveText(fixture, "Restart capture\n\nOne stable source.");
    const initial = makeJobs(fixture.vaultPort);
    expect(readJob(jobPath(fixture.vaultPath, captured.jobId)).state).toBe("queued");

    const restarted = makeJobs(fixture.vaultPort);
    expect(restarted.captureExecutor().process({ limit: 20 })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    const completed = readJob(jobPath(fixture.vaultPath, captured.jobId));
    expect(completed).toMatchObject({ state: "completed", sourceId: captured.sourceId });
    expect(completed.outputRefs?.filter((ref) => ref.kind === "source")).toHaveLength(1);
    expect(findFiles(path.join(fixture.vaultPath, "sources"), ".md")).toHaveLength(1);
    expect(initial.captureExecutor().process({ jobIds: [captured.jobId] }).processed).toBe(0);
  });

  it("fails closed when the active vault changes after selection but before begin", () => {
    const first = makeVault("CaptureVaultA");
    const second = makeVault("CaptureVaultB");
    const captured = preserveText(first, "Bound capture source.");
    let active = first;
    let leaseChecks = 0;
    const vaults: JobsVaultPort = {
      current: () => active.vault,
      activeVaultPath: () => active.vaultPath,
      assertWriterLease: (vaultPath) => {
        if (vaultPath !== active.vaultPath) {
          throw new PigeDomainError("vault.binding_changed", "The active vault changed before Capture execution.");
        }
        leaseChecks += 1;
        if (leaseChecks === 1) active = second;
      }
    };
    const sourcePages = new HookedSourcePageService(() => {
      throw new Error("must not publish");
    });
    const jobs = makeJobs(vaults, sourcePages);

    expect(() => jobs.captureExecutor().process({ jobIds: [captured.jobId] }))
      .toThrowError(expect.objectContaining({ code: "vault.binding_changed" }));
    expect(sourcePages.calls).toBe(0);
    expect(readJob(jobPath(first.vaultPath, captured.jobId)).state).toBe("queued");
    expect(findFiles(path.join(second.vaultPath, ".pige", "jobs"), ".json")).toEqual([]);
  });
});

class HookedSourcePageService extends SourcePageService {
  calls = 0;
  readonly #afterPublication: (result: SourcePageResult) => void;

  constructor(afterPublication: (result: SourcePageResult) => void) {
    super();
    this.#afterPublication = afterPublication;
  }

  override createForSource(
    ...args: Parameters<SourcePageService["createForSource"]>
  ): ReturnType<SourcePageService["createForSource"]> {
    this.calls += 1;
    const result = super.createForSource(...args);
    this.#afterPublication(result);
    return result;
  }
}

interface VaultFixture {
  readonly root: string;
  readonly vaultPath: string;
  readonly vault: VaultSummary;
  readonly vaultPort: JobsVaultPort;
}

function makeVault(name: string): VaultFixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-capture-executor-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: name,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-26T05:00:00.000Z")
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

function makeJobs(vaultPort: JobsVaultPort, sourcePages = new SourcePageService()): JobsService {
  return new JobsService(
    vaultPort,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    createJobClassExecutorRegistry(),
    sourcePages
  );
}

function preserveText(fixture: VaultFixture, text: string) {
  return new LegacyCaptureFixture(fixture.vaultPort, fixture.vaultPath).submitText({
    text,
    inputKind: "typed_text",
    userIntent: "capture",
    locale: "en"
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
