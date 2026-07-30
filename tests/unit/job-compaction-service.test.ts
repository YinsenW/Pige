import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfirmationProposalSchema,
  JobRecordSchema,
  OperationRecordSchema,
  type JobRecord
} from "@pige/schemas";
import { JobCompactionService } from "../../apps/desktop/src/main/services/job-compaction-service";

const NOW = new Date("2026-07-30T12:00:00.000Z");
const OLD_FINISHED_AT = "2026-03-01T10:00:00.000Z";
const RECENT_FINISHED_AT = "2026-07-29T10:00:00.000Z";
const CHECKSUM = `sha256:${"a".repeat(64)}` as const;
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("JobCompactionService", () => {
  it("compacts only retained successful detail and preserves durable trust references", () => {
    const fixture = createFixture();
    const child = job({
      id: "job_20260729_childjob1",
      state: "completed",
      finishedAt: RECENT_FINISHED_AT,
      updatedAt: RECENT_FINISHED_AT
    });
    const parent = job({
      id: "job_20260301_parentjob1",
      state: "completed_with_warnings",
      finishedAt: OLD_FINISHED_AT,
      updatedAt: OLD_FINISHED_AT,
      childJobIds: [child.id],
      sourceId: "src_20260301_source001",
      conversationEventId: "evt_20260301_event0001",
      policyContextId: "policy_20260301_parentjob1",
      policyHash: CHECKSUM,
      inputRefs: [{ kind: "source", id: "src_20260301_source001", checksum: CHECKSUM }],
      outputRefs: [{ kind: "page", id: "page_20260301_page0001", checksum: CHECKSUM }],
      permissionRequestIds: ["permreq_20260301_abcdef1234567890"],
      permissionDecisionIds: ["permdec_20260301_abcdef1234567890"],
      proposalIds: ["proposal_20260301_proposal01"],
      operationIds: ["op_20260301_existing01"],
      stage: "writing",
      checkpoints: [{
        id: "checkpoint_write",
        step: "write",
        state: "done",
        inputRefs: [{ kind: "source", id: "src_20260301_source001" }],
        outputRefs: [{ kind: "page", id: "page_20260301_page0001" }],
        checksumAfter: CHECKSUM
      }],
      progress: { completedUnits: 4, totalUnits: 4, unit: "steps" },
      warnings: [{ domain: "source_storage", code: "source_storage.partial", messageKey: "warnings.source.partial" }],
      retry: { retryCount: 1, maxAutomaticRetries: 2 },
      cancellation: { durableWritesApplied: true },
      privacy: {
        usedCloudModel: false,
        usedNetwork: false,
        usedShell: false,
        accessedExternalFiles: true
      },
      message: "Imported one source with a recoverable warning."
    });
    writeJob(fixture.vaultPath, child);
    const parentPath = writeJob(fixture.vaultPath, parent);
    writeProposal(fixture.vaultPath, parent.proposalIds![0]!);
    const preserved = seedPreservedRecords(fixture.vaultPath);

    const first = fixture.service.compactEligible();
    expect(first).toEqual({ scanned: 2, compacted: 1, skipped: 1, conflicted: 0, failed: 0 });

    const compacted = JobRecordSchema.parse(JSON.parse(fs.readFileSync(parentPath, "utf8")));
    expect(compacted).toMatchObject({
      id: parent.id,
      state: "compacted",
      class: parent.class,
      createdAt: parent.createdAt,
      finishedAt: parent.finishedAt,
      sourceId: parent.sourceId,
      conversationEventId: parent.conversationEventId,
      inputRefs: parent.inputRefs,
      outputRefs: parent.outputRefs,
      proposalIds: parent.proposalIds,
      permissionRequestIds: parent.permissionRequestIds,
      permissionDecisionIds: parent.permissionDecisionIds,
      progress: parent.progress,
      warnings: parent.warnings,
      privacy: parent.privacy,
      message: parent.message,
      compaction: {
        schemaVersion: 1,
        previousState: "completed_with_warnings",
        removedCheckpointCount: 1,
        retainedReferenceCount: 6,
        durationMs: 3_600_000
      }
    });
    expect(compacted).not.toHaveProperty("stage");
    expect(compacted).not.toHaveProperty("checkpoints");
    expect(compacted).not.toHaveProperty("retry");
    expect(compacted).not.toHaveProperty("cancellation");
    expect(compacted.operationIds).toEqual(expect.arrayContaining(["op_20260301_existing01"]));

    const operations = readJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"));
    expect(operations).toHaveLength(1);
    const operation = OperationRecordSchema.parse(operations[0]);
    expect(operation).toMatchObject({ kind: "compact_job", jobId: parent.id, reversible: "no" });
    expect(compacted.operationIds).toContain(operation.id);
    expect(operation.before?.checksum).toBe(compacted.compaction?.detailSha256);
    expect(operation.after?.checksum).toBe(sha256(fs.readFileSync(parentPath)));
    expect(readPreservedRecords(fixture.vaultPath)).toEqual(preserved);

    expect(fixture.service.compactEligible()).toEqual({
      scanned: 2,
      compacted: 0,
      skipped: 2,
      conflicted: 0,
      failed: 0
    });
    expect(readJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(1);
  });

  it("retains recent, unresolved, failed, and incompletely audited jobs", () => {
    const fixture = createFixture();
    const runningChild = job({ id: "job_20260301_running001", state: "running", finishedAt: undefined });
    const records = [
      job({ id: "job_20260729_recent0001", state: "completed", finishedAt: RECENT_FINISHED_AT }),
      job({ id: "job_20260301_failed0001", state: "failed_final", finishedAt: OLD_FINISHED_AT }),
      job({ id: "job_20260301_waiting001", state: "waiting_dependency", finishedAt: undefined }),
      runningChild,
      job({ id: "job_20260301_parent0002", childJobIds: [runningChild.id] }),
      job({ id: "job_20260301_proposal02", proposalIds: ["proposal_20260301_missing001"] }),
      job({
        id: "job_20260301_permission",
        permissionRequestIds: ["permreq_20260301_abcdef1234567890"]
      })
    ];
    for (const record of records) writeJob(fixture.vaultPath, record);
    const before = readJobBodies(fixture.vaultPath);

    expect(fixture.service.compactEligible()).toEqual({
      scanned: records.length,
      compacted: 0,
      skipped: records.length,
      conflicted: 0,
      failed: 0
    });
    expect(readJobBodies(fixture.vaultPath)).toEqual(before);
    expect(readJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toEqual([]);
  });

  it("fails closed on revision drift before publishing a compaction operation", () => {
    const fixture = createFixture({
      beforeCommit: (snapshot) => {
        const changed = JobRecordSchema.parse({
          ...snapshot.job,
          updatedAt: "2026-07-30T12:00:00.001Z",
          message: "A concurrent owner refreshed this summary."
        });
        fs.writeFileSync(snapshot.path, `${JSON.stringify(changed, null, 2)}\n`, { mode: 0o600 });
      }
    });
    const original = job({ id: "job_20260301_driftjob1" });
    const filePath = writeJob(fixture.vaultPath, original);

    expect(fixture.service.compactEligible()).toEqual({
      scanned: 1,
      compacted: 0,
      skipped: 0,
      conflicted: 1,
      failed: 0
    });
    expect(JobRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")))).toMatchObject({
      state: "completed",
      message: "A concurrent owner refreshed this summary."
    });
    expect(readJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toEqual([]);
  });

  it("adopts a committed compaction operation after restart without duplicating effects", () => {
    let interrupt = true;
    const fixture = createFixture({
      afterOperationCommit: () => {
        if (interrupt) {
          interrupt = false;
          throw new Error("simulated process interruption");
        }
      }
    });
    const original = job({ id: "job_20260301_restart01" });
    const filePath = writeJob(fixture.vaultPath, original);

    expect(fixture.service.compactEligible()).toEqual({
      scanned: 1,
      compacted: 0,
      skipped: 0,
      conflicted: 0,
      failed: 1
    });
    expect(JobRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8"))).state).toBe("completed");
    expect(readJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(1);

    const restarted = createService(fixture.vaultPath, {
      now: () => new Date("2026-07-31T12:00:00.000Z")
    });
    expect(restarted.compactEligible()).toEqual({
      scanned: 1,
      compacted: 1,
      skipped: 0,
      conflicted: 0,
      failed: 0
    });
    const adopted = JobRecordSchema.parse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    expect(adopted.state).toBe("compacted");
    expect(adopted.compaction?.compactedAt).toBe(NOW.toISOString());
    expect(readJsonFiles(path.join(fixture.vaultPath, ".pige", "operations"))).toHaveLength(1);
  });
});

function createFixture(options: ConstructorParameters<typeof JobCompactionService>[1] = {}): {
  vaultPath: string;
  service: JobCompactionService;
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-job-compaction-")));
  roots.push(root);
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(path.join(vaultPath, ".pige", "jobs"), { recursive: true, mode: 0o700 });
  fs.chmodSync(vaultPath, 0o700);
  fs.chmodSync(path.join(vaultPath, ".pige"), 0o700);
  fs.chmodSync(path.join(vaultPath, ".pige", "jobs"), 0o700);
  return { vaultPath, service: createService(vaultPath, options) };
}

function createService(
  vaultPath: string,
  options: ConstructorParameters<typeof JobCompactionService>[1] = {}
): JobCompactionService {
  return new JobCompactionService({
    activeVaultPath: () => vaultPath,
    assertWriterLease: (candidate) => {
      if (candidate !== vaultPath) throw new Error("stale writer");
    }
  }, { now: () => NOW, ...options });
}

function job(overrides: Partial<JobRecord> & Pick<JobRecord, "id">): JobRecord {
  return JobRecordSchema.parse({
    schemaVersion: 1,
    class: "agent_turn",
    state: "completed",
    createdAt: "2026-03-01T09:00:00.000Z",
    updatedAt: OLD_FINISHED_AT,
    startedAt: "2026-03-01T09:00:00.000Z",
    finishedAt: OLD_FINISHED_AT,
    activeVaultId: "vault_20260301_abcdef123456",
    message: "Completed retained work.",
    ...overrides
  });
}

function writeJob(vaultPath: string, record: JobRecord): string {
  const date = /^job_(\d{8})_/.exec(record.id)![1]!;
  const directory = path.join(vaultPath, ".pige", "jobs", date.slice(0, 4), date.slice(4, 6));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(path.dirname(directory), 0o700);
  fs.chmodSync(directory, 0o700);
  const filePath = path.join(directory, `${record.id}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  return filePath;
}

function writeProposal(vaultPath: string, proposalId: string): void {
  const date = /^proposal_(\d{8})_/.exec(proposalId)![1]!;
  const directory = path.join(vaultPath, ".pige", "proposals", date.slice(0, 4), date.slice(4, 6));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const proposal = ConfirmationProposalSchema.parse({
    id: proposalId,
    schemaVersion: 1,
    jobId: "job_20260301_parentjob1",
    createdAt: OLD_FINISHED_AT,
    updatedAt: OLD_FINISHED_AT,
    state: "applied",
    trustLevel: "review_required",
    summary: "Reviewed retained change.",
    reason: "The user approved the durable operation.",
    sourceRefs: [],
    targetRefs: [],
    proposedOperations: [],
    diffRefs: [],
    warnings: [],
    baseHashes: {},
    decision: { decidedAt: OLD_FINISHED_AT, decidedBy: "user" }
  });
  fs.writeFileSync(path.join(directory, `${proposalId}.json`), `${JSON.stringify(proposal, null, 2)}\n`, { mode: 0o600 });
}

function seedPreservedRecords(vaultPath: string): Record<string, string> {
  const records = {
    ".pige/conversations/2026/03/conv_20260301_convo001.jsonl": '{"eventId":"evt_20260301_event0001"}\n',
    ".pige/source-records/2026/03/src_20260301_source001.json": '{"id":"src_20260301_source001"}\n',
    "log.md": "# Durable log\n"
  };
  for (const [relativePath, body] of Object.entries(records)) {
    const filePath = path.join(vaultPath, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filePath, body, { mode: 0o600 });
  }
  return records;
}

function readPreservedRecords(vaultPath: string): Record<string, string> {
  return {
    ".pige/conversations/2026/03/conv_20260301_convo001.jsonl": fs.readFileSync(
      path.join(vaultPath, ".pige/conversations/2026/03/conv_20260301_convo001.jsonl"), "utf8"
    ),
    ".pige/source-records/2026/03/src_20260301_source001.json": fs.readFileSync(
      path.join(vaultPath, ".pige/source-records/2026/03/src_20260301_source001.json"), "utf8"
    ),
    "log.md": fs.readFileSync(path.join(vaultPath, "log.md"), "utf8")
  };
}

function readJobBodies(vaultPath: string): string[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"), ".json")
    .map((filePath) => fs.readFileSync(filePath, "utf8"));
}

function readJsonFiles(root: string): unknown[] {
  if (!fs.existsSync(root)) return [];
  return listFiles(root, ".json").map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
}

function listFiles(root: string, extension: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(candidate, extension) : entry.isFile() && entry.name.endsWith(extension) ? [candidate] : [];
  }).sort();
}

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
