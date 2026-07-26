import { describe, expect, it, vi } from "vitest";
import { JobRecordSchema, SourceRecordSchema } from "@pige/schemas";
import type { AgentIngestService } from "../../apps/desktop/src/main/services/agent-ingest-service";
import {
  LegacyAgentIngestJobExecutor,
  type ActiveLegacyAgentIngestJob,
  type QueuedLegacyAgentIngestJob
} from "../../apps/desktop/src/main/services/legacy-agent-ingest-job-executor";

describe("LegacyAgentIngestJobExecutor", () => {
  it("runs historical candidates in queue order and always releases cooperative execution", async () => {
    const events: string[] = [];
    const first = makeCandidate("job_20260726_legacy01", events);
    const second = makeCandidate("job_20260726_legacy02", events);
    const ingestSource = vi.fn(async (_vaultPath, _source, job) => {
      events.push(`ingest:${job.id}`);
      return {
        outcome: "responded" as const,
        answer: "Historical recovery completed.",
        evidenceRefs: [],
        operationIds: []
      };
    });
    const executor = new LegacyAgentIngestJobExecutor(
      { ingestSource } as unknown as AgentIngestService,
      undefined,
      { queued: () => [first, second] }
    );

    await expect(executor.process({ limit: 2 })).resolves.toEqual({
      processed: 2,
      completed: 2,
      failed: 0
    });
    expect(events).toEqual([
      "begin:job_20260726_legacy01",
      "ingest:job_20260726_legacy01",
      "settle:job_20260726_legacy01:responded",
      "finish:job_20260726_legacy01",
      "begin:job_20260726_legacy02",
      "ingest:job_20260726_legacy02",
      "settle:job_20260726_legacy02:responded",
      "finish:job_20260726_legacy02"
    ]);
  });

  it("waits without starting model work when the compatibility dependency is unavailable", async () => {
    const events: string[] = [];
    const candidate = makeCandidate("job_20260726_legacy03", events);
    const executor = new LegacyAgentIngestJobExecutor(undefined, undefined, {
      queued: () => [candidate]
    });

    await expect(executor.process()).resolves.toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(events).toEqual(["wait-model:job_20260726_legacy03"]);
  });

  it("settles a provider failure through the typed Job adapter and still finishes", async () => {
    const events: string[] = [];
    const candidate = makeCandidate("job_20260726_legacy04", events);
    const executor = new LegacyAgentIngestJobExecutor(
      {
        ingestSource: vi.fn(async () => {
          throw new Error("synthetic body must remain inside the owning adapter");
        })
      } as unknown as AgentIngestService,
      undefined,
      { queued: () => [candidate] }
    );

    await expect(executor.process()).resolves.toEqual({ processed: 1, completed: 0, failed: 1 });
    expect(events).toEqual([
      "begin:job_20260726_legacy04",
      "fail:job_20260726_legacy04",
      "finish:job_20260726_legacy04"
    ]);
  });
});

function makeCandidate(jobId: string, events: string[]): QueuedLegacyAgentIngestJob {
  const job = JobRecordSchema.parse({
    id: jobId,
    class: "agent_ingest",
    state: "queued",
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: "2026-07-26T08:00:00.000Z",
    sourceId: `src_20260726_${jobId.slice(-8)}`,
    message: "Historical compatibility recovery queued."
  });
  const source = SourceRecordSchema.parse({
    id: job.sourceId,
    kind: "text",
    storageStrategy: "reference_original",
    createdAt: "2026-07-26T08:00:00.000Z",
    updatedAt: "2026-07-26T08:00:00.000Z",
    semanticOrchestration: "legacy_agent_ingest",
    original: { uri: "pige://synthetic/legacy.txt", displayName: "legacy.txt" },
    artifacts: [],
    metadata: {}
  });
  return {
    job,
    vaultPath: "/synthetic-vault",
    source: { path: "/synthetic-vault/.pige/sources/legacy.txt", record: source },
    waitForModel: () => events.push(`wait-model:${job.id}`),
    failMissingSource: () => events.push(`missing-source:${job.id}`),
    waitForOcr: () => events.push(`wait-ocr:${job.id}`),
    begin: () => {
      events.push(`begin:${job.id}`);
      return {
        job: { ...job, state: "running" },
        hooks: {
          onPolicyResolved: () => undefined,
          assertSourceCurrent: () => undefined,
          parseCurrentSource: async () => { throw new Error("unused"); },
          materializeCurrentDataset: async () => { throw new Error("unused"); },
          hasDurableDatasetEffect: () => false,
          ocrCurrentSource: async () => { throw new Error("unused"); },
          throwIfCancellationRequested: () => undefined,
          onPublicationStart: () => undefined,
          onProposalStaged: () => undefined,
          signal: new AbortController().signal
        },
        settle: (result) => {
          events.push(`settle:${job.id}:${result.outcome}`);
          return true;
        },
        fail: () => {
          events.push(`fail:${job.id}`);
          return "failed";
        },
        finish: () => events.push(`finish:${job.id}`)
      } satisfies ActiveLegacyAgentIngestJob;
    }
  };
}
