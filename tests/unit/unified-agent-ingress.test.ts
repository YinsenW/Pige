import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  HomeAgentAskRequest,
  ModelProviderSettingsSummary,
  RetrievalAskResult,
  RetrievalSearchResult,
  VaultSummary
} from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import {
  HomeAgentService,
  type HomeAgentModelPort,
  type HomeAgentRetrievalPort
} from "../../apps/desktop/src/main/services/home-agent-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { PiAgentRuntimeAdapter } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_unified_ingress",
    displayName: "Unified ingress local provider",
    providerKind: "openai_compatible",
    endpointProtocol: "openai_responses",
    baseUrl: "http://127.0.0.1:43124/v1",
    authSecretRef: "provider_secret_unified_ingress",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  model: {
    id: "model_unified_ingress",
    providerProfileId: "provider_unified_ingress",
    modelId: "unified-ingress-model",
    displayName: "Unified ingress model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z"
  },
  apiKey: "synthetic-unified-ingress-key"
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Unified Agent ingress", () => {
  it("preserves one dropped source and lets the agent_turn own inspect and publication", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "unified-source.txt");
    fs.writeFileSync(sourceFile, "Pige keeps host preservation separate from Agent semantic planning.\n", "utf8");
    const models = createMutableModels(true);
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: groundedOutput("Unified source result")
        }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs);
    const prepared = home.prepareSourceTurn({
      inputKind: "file_drop",
      objective: "auto",
      locale: "en"
    });
    const preserved = await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_drop",
      userIntent: "unknown",
      locale: "en"
    }, {
      jobId: prepared.jobId,
      sourceId: prepared.sourceId
    });

    expect(preserved).toMatchObject({ status: "queued", jobIds: [], sourceIds: [expect.any(String)] });
    const outcome = await home.submitPreparedSourceTurn(prepared);

    expect(outcome).toMatchObject({
      state: "completed",
      modelUsage: "local",
      sourceIds: preserved.sourceIds,
      answer: { grounding: "source", citations: [] }
    });
    const allJobs = jobs.list({ limit: 20 }).jobs;
    expect(allJobs).toEqual([
      expect.objectContaining({ id: outcome.jobId, class: "agent_turn", state: "completed" })
    ]);
    expect(allJobs.some((job) => ["capture", "agent_ingest"].includes(job.class))).toBe(false);
    expect(readJobs(fixture.vaultPath)[0]?.inputRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "conversation", role: "agent_turn_user_event" }),
      expect.objectContaining({ kind: "source", id: preserved.sourceIds[0], role: "agent_turn_source" })
    ]));
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toHaveLength(1);
  });

  it("lets the same dropped-source ingress answer through Pi without forcing publication", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "answer-only-source.txt");
    fs.writeFileSync(sourceFile, "The source can support a direct answer without becoming a note.\n", "utf8");
    const models = createMutableModels(true);
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        {
          kind: "tool_call",
          toolName: "pige_respond_to_user",
          args: { answer: "The preserved source supports a direct answer.", evidenceRefs: ["ev_01"] }
        }
      ]
    })));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs);
    const prepared = home.prepareSourceTurn({
      text: "Summarize this without saving a note.",
      inputKind: "file_drop",
      objective: "auto",
      locale: "en"
    });
    const preserved = await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_drop",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });

    const outcome = await home.submitPreparedSourceTurn(prepared);

    expect(outcome).toMatchObject({
      state: "completed",
      sourceIds: preserved.sourceIds,
      answer: {
        answer: "The preserved source supports a direct answer.",
        grounding: "source",
        citations: []
      }
    });
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toHaveLength(0);
    expect(listFiles(path.join(fixture.vaultPath, ".pige", "source-records"), ".json")).toHaveLength(1);
    expect(jobs.list({ limit: 20 }).jobs).toEqual([
      expect.objectContaining({ id: prepared.jobId, class: "agent_turn", state: "completed" })
    ]);
  });

  it("reconciles a crash after SourceRecord persistence and before Agent turn linkage", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "handoff-crash-source.txt");
    fs.writeFileSync(sourceFile, "The durable handoff must survive a restart boundary.\n", "utf8");
    const models = createMutableModels(true);
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        {
          kind: "tool_call",
          toolName: "pige_respond_to_user",
          args: { answer: "The restarted turn reused its preserved source.", evidenceRefs: ["ev_01"] }
        }
      ]
    });
    const firstJobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, firstJobs);
    const prepared = home.prepareSourceTurn({
      text: "Read this after restart.",
      inputKind: "file_picker",
      objective: "auto",
      locale: "en"
    });
    await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });

    expect(firstJobs.readAgentTurnJob(prepared.jobId)).toMatchObject({
      state: "waiting_dependency",
      stage: "capturing_source",
      sourceId: prepared.sourceId
    });
    const restarted = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    expect(restarted.reconcilePendingAgentTurnSources()).toEqual({ linked: 1, waiting: 0, failed: 0 });
    expect(restarted.readAgentTurnJob(prepared.jobId)).toMatchObject({
      state: "queued",
      sourceId: prepared.sourceId
    });
    expect(await restarted.processQueuedAgentIngest({ jobIds: [prepared.jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(restarted.readAgentTurnJob(prepared.jobId)).toMatchObject({ state: "completed" });
    expect(listFiles(path.join(fixture.vaultPath, ".pige", "source-records"), ".json")).toHaveLength(1);
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toHaveLength(0);
  });

  it("keeps the same source agent_turn waiting and resumes it after the model binding becomes ready", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "waiting-source.txt");
    fs.writeFileSync(sourceFile, "The preserved source must survive model setup.\n", "utf8");
    const models = createMutableModels(false);
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        {
          kind: "tool_call",
          toolName: "pige_create_knowledge_note",
          args: groundedOutput("Resumed source result")
        }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const preserved = await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    });
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs);
    const waiting = await home.submitTurn(
      { inputKind: "file_picker", objective: "auto", locale: "en" },
      { sourceIds: preserved.sourceIds }
    );

    expect(waiting).toMatchObject({
      state: "waiting",
      modelUsage: "none",
      error: { code: "model_provider.default_model_missing" }
    });
    expect(jobs.list({ classes: ["agent_turn"] }).jobs).toEqual([
      expect.objectContaining({ id: waiting.jobId, state: "waiting_dependency", stage: "waiting_for_model" })
    ]);

    models.setReady(true);
    expect(jobs.requeueWaitingAgentIngest()).toEqual({ requeued: 1 });
    expect(await jobs.processQueuedAgentIngest({ jobIds: [waiting.jobId] })).toEqual({
      processed: 1,
      completed: 1,
      failed: 0
    });
    expect(jobs.list({ classes: ["agent_turn"] }).jobs).toEqual([
      expect.objectContaining({ id: waiting.jobId, state: "completed" })
    ]);
    expect(jobs.list({ classes: ["capture", "agent_ingest"] }).jobs).toEqual([]);
  });
});

interface MutableModels extends HomeAgentModelPort, AgentIngestModelConfigPort {
  setReady(value: boolean): void;
}

function createMutableModels(initiallyReady: boolean): MutableModels {
  let ready = initiallyReady;
  const provider = { ...runtimeConfig.provider };
  const model = { ...runtimeConfig.model, isDefault: true };
  const summary = (): ModelProviderSettingsSummary => ready
    ? {
        presets: [],
        providers: [provider],
        models: [model],
        defaultModelProfileId: model.id,
        hasDefaultModel: true,
        defaultBinding: {
          state: "ready",
          providerProfileId: provider.id,
          modelProfileId: model.id
        }
      }
    : {
        presets: [],
        providers: [],
        models: [],
        hasDefaultModel: false,
        defaultBinding: { state: "not_configured" }
      };
  return {
    setReady: (value) => { ready = value; },
    summary,
    getDefaultModel: () => ready ? model : undefined,
    getDefaultProvider: () => ready ? provider : undefined,
    hasDefaultRuntimeBinding: () => ready,
    getDefaultRuntimeConfig: () => ready ? runtimeConfig : undefined
  };
}

const neverRetrieval: HomeAgentRetrievalPort = {
  search: (_request: HomeAgentAskRequest): RetrievalSearchResult => {
    throw new Error("Source-only unified ingress must not use the Home retrieval port.");
  },
  ask: (_request: HomeAgentAskRequest): RetrievalAskResult => {
    throw new Error("Source-only unified ingress must not use the Home retrieval port.");
  }
};

function groundedOutput(title: string) {
  return {
    title,
    summary: { text: "Host preservation completed before Agent planning.", evidenceRefs: ["ev_01"] },
    keyPoints: [{ text: "The source is processed only through registered tools.", evidenceRefs: ["ev_01"] }],
    tags: ["pige"],
    topics: ["Agent architecture"],
    entities: [],
    warnings: [],
    confidence: "high"
  };
}

function makeVault(): {
  readonly vaultPath: string;
  readonly vaultPort: { current(): VaultSummary; activeVaultPath(): string };
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-unified-agent-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "UnifiedAgent",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-12T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "UnifiedAgent");
  const vault = loadVaultSummary(vaultPath);
  return { vaultPath, vaultPort: { current: () => vault, activeVaultPath: () => vaultPath } };
}

function readJobs(vaultPath: string): JobRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "jobs"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as JobRecord);
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  });
}
