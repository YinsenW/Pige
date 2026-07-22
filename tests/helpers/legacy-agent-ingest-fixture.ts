import fs from "node:fs";
import path from "node:path";
import { JobRecordSchema, type JobRecord } from "@pige/schemas";
import { loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

export function markSourceAsLegacyAgentIngestFixture(vaultPath: string, sourceId: string): void {
  const root = path.join(vaultPath, ".pige", "source-records");
  const sourceRecordPath = findNamedFile(root, `${sourceId}.json`);
  if (!sourceRecordPath) throw new Error(`Missing legacy SourceRecord fixture for ${sourceId}.`);
  const sourceRecord = JSON.parse(fs.readFileSync(sourceRecordPath, "utf8")) as {
    semanticOrchestration?: unknown;
    metadata: Record<string, unknown>;
  };
  delete sourceRecord.semanticOrchestration;
  delete sourceRecord.metadata.semanticOrchestration;
  fs.writeFileSync(sourceRecordPath, `${JSON.stringify(sourceRecord, null, 2)}\n`, "utf8");
}

export function seedHistoricalAgentIngestJobFixture(vaultPath: string, sourceId: string): JobRecord {
  const jobsRoot = path.join(vaultPath, ".pige", "jobs");
  const parentPath = findJobPath(jobsRoot, (job) => job.class === "capture" && job.sourceId === sourceId);
  if (!parentPath) throw new Error(`Missing historical capture Job fixture for ${sourceId}.`);
  const parent = JSON.parse(fs.readFileSync(parentPath, "utf8")) as JobRecord;
  const dateKey = /^src_(\d{8})_/u.exec(sourceId)?.[1] ?? "20260711";
  const suffix = sourceId.replace(/^src_\d{8}_/u, "").slice(0, 10);
  const jobId = `job_${dateKey}_${suffix}ag`;
  const now = "2026-07-11T00:00:00.000Z";
  const activeVaultId = loadVaultSummary(vaultPath).vaultId;
  const job = JobRecordSchema.parse({
    id: jobId,
    class: "agent_ingest",
    state: "queued",
    parentJobId: parent.id,
    createdAt: now,
    updatedAt: now,
    sourceId,
    activeVaultId,
    ...(parent.captureId ? { captureId: parent.captureId } : {}),
    ...(parent.conversationEventId ? { conversationEventId: parent.conversationEventId } : {}),
    message: "Historical Agent ingest fixture queued."
  });
  const jobPath = path.join(jobsRoot, dateKey.slice(0, 4), dateKey.slice(4, 6), `${jobId}.json`);
  fs.mkdirSync(path.dirname(jobPath), { recursive: true });
  fs.writeFileSync(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
  fs.writeFileSync(parentPath, `${JSON.stringify(JobRecordSchema.parse({
    ...parent,
    childJobIds: [...new Set([...(parent.childJobIds ?? []), job.id])],
    updatedAt: now
  }), null, 2)}\n`, "utf8");
  return job;
}

function findNamedFile(root: string, name: string): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  const pending = [root];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name === name) return candidate;
    }
  }
  return undefined;
}

function findJobPath(root: string, predicate: (job: JobRecord) => boolean): string | undefined {
  if (!fs.existsSync(root)) return undefined;
  for (const filePath of listJsonFiles(root)) {
    const job = JobRecordSchema.safeParse(JSON.parse(fs.readFileSync(filePath, "utf8")));
    if (job.success && predicate(job.data)) return filePath;
  }
  return undefined;
}

function listJsonFiles(root: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) return listJsonFiles(candidate);
    return entry.isFile() && entry.name.endsWith(".json") ? [candidate] : [];
  });
}
