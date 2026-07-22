import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ModelProviderSettingsSummary,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  VaultSummary
} from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestCapabilityPort,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { executeDatasetQuery } from "../../apps/desktop/src/main/services/dataset-query-core";
import { DatasetQueryService } from "../../apps/desktop/src/main/services/dataset-query-service";
import {
  DATASET_QUERY_PROTOCOL_VERSION,
  type DatasetQueryCatalogScope,
  type DatasetQueryExecutor
} from "../../apps/desktop/src/main/services/dataset-query-types";
import { DatasetService, type DatasetImportPlanner } from "../../apps/desktop/src/main/services/dataset-service";
import type { DatasetIngestPlan } from "../../apps/desktop/src/main/services/dataset-ingest-types";
import {
  HomeAgentService,
  type HomeAgentDatasetQueryPort,
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
  it.each([
    ["en", "Organize these files."],
    ["zh-Hans", "整理这些文件。"],
    ["ja", "これらのファイルを整理してください。"],
    ["ko", "이 파일들을 정리해 주세요."],
    ["fr", "Organisez ces fichiers."],
    ["de", "Organisiere diese Dateien."]
  ] as const)("uses the minimal attachment-only intent for %s", (locale, expectedText) => {
    const fixture = makeVault();
    const home = new HomeAgentService(
      fixture.vaultPort,
      createMutableModels(false),
      neverRetrieval,
      new JobsService(fixture.vaultPort)
    );

    home.prepareSourceTurn({ inputKind: "file_picker", locale });

    expect(home.conversation()?.messages).toEqual([
      expect.objectContaining({ role: "user", text: expectedText })
    ]);
  });

  it("preserves an explicit attachment query byte-for-byte", () => {
    const fixture = makeVault();
    const home = new HomeAgentService(
      fixture.vaultPort,
      createMutableModels(false),
      neverRetrieval,
      new JobsService(fixture.vaultPort)
    );
    const text = "  Compare these files.\nKeep this spacing.  ";

    home.prepareSourceTurn({ text, inputKind: "file_picker", locale: "en" });

    expect(home.conversation()?.messages).toEqual([
      expect.objectContaining({ role: "user", text })
    ]);
  });

  it("continues one preserved CSV turn through Pi-selected materialization and a cited Dataset answer", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "regional-counts.csv");
    const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
    fs.writeFileSync(sourceFile, sourceBytes);
    const models = createMutableModels(true);
    const datasetService = new DatasetService(new StaticDatasetPlanner(csvPlan(sourceBytes)));
    const runtime = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_inspect_dataset", args: {} },
        { kind: "tool_call", toolName: "pige_query_dataset", args: { action: "catalog" } },
        {
          kind: "tool_call",
          toolName: "pige_query_dataset",
          args: {
            action: "query",
            datasetRef: "dataset_1",
            tableRef: "table_1",
            select: ["column_1", "column_2"],
            orderBy: [{ by: "column_2", direction: "desc" }],
            limit: 2
          }
        },
        { kind: "text", text: "Grace has the largest count in the attached Dataset. [citation_9]" }
      ]
    });
    const datasetQueries = new DatasetQueryService(directDatasetExecutor);
    let observedCatalogScope: DatasetQueryCatalogScope | undefined;
    const scopedDatasets: HomeAgentDatasetQueryPort = {
      createCatalog: (vaultPath, signal, scope) => {
        observedCatalogScope = scope;
        return datasetQueries.createCatalog(vaultPath, signal, scope);
      },
      revalidateCatalog: (vaultPath, catalog, signal) =>
        datasetQueries.revalidateCatalog(vaultPath, catalog, signal),
      execute: (vaultPath, catalog, request, signal) =>
        datasetQueries.execute(vaultPath, catalog, request, signal),
      revalidateResult: (vaultPath, result, signal) =>
        datasetQueries.revalidateResult(vaultPath, result, signal)
    };
    const jobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(models, runtime, datasetCapabilities),
      undefined,
      undefined,
      undefined,
      datasetService
    );
    const home = new HomeAgentService(
      fixture.vaultPort,
      models,
      neverRetrieval,
      jobs,
      runtime,
      datasetCapabilities,
      undefined,
      undefined,
      scopedDatasets
    );
    const prepared = home.prepareSourceTurn({
      text: "Which person has the largest count?",
      inputKind: "file_picker",
      locale: "en"
    });
    const preserved = await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });

    const outcome = await home.submitPreparedSourceTurn(prepared);

    expect(
      outcome.state,
      JSON.stringify({ outcome, jobs: readJobs(fixture.vaultPath) })
    ).toBe("completed");
    expect(outcome).toMatchObject({
      state: "completed",
      jobId: prepared.jobId,
      sourceIds: preserved.sourceIds,
      answer: {
        answer: "Grace has the largest count in the attached Dataset. [citation_9]",
        grounding: "local_knowledge",
        citations: [expect.objectContaining({ kind: "dataset", refId: "citation_9" })],
        datasetResult: expect.objectContaining({ returnedRowCount: 2, matchedRowCount: 2 })
      }
    });
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "agent_turn")).toEqual([
      expect.objectContaining({
        id: prepared.jobId,
        state: "completed",
        outputRefs: expect.arrayContaining([
          expect.objectContaining({ kind: "dataset", role: "agent_dataset" }),
          expect.objectContaining({ kind: "dataset_revision", role: "agent_dataset_revision" }),
          expect.objectContaining({ kind: "conversation", role: "agent_turn_assistant_event" })
        ])
      })
    ]);
    expect(jobs.list({ classes: ["dataset_import"] }).jobs).toHaveLength(1);
    const durableParent = requireValue(readJobs(fixture.vaultPath).find((job) => job.id === prepared.jobId));
    expect(observedCatalogScope).toEqual({
      sourceId: prepared.sourceId,
      datasetId: requireValue(durableParent.outputRefs?.find(
        (ref) => ref.kind === "dataset" && ref.role === "agent_dataset"
      )?.id),
      revisionId: requireValue(durableParent.outputRefs?.find(
        (ref) => ref.kind === "dataset_revision" && ref.role === "agent_dataset_revision"
      )?.id)
    });
    expect(home.conversation()?.messages.at(-1)).toMatchObject({
      role: "assistant",
      answer: expect.objectContaining({
        answer: "Grace has the largest count in the attached Dataset. [citation_9]",
        datasetResult: expect.objectContaining({ returnedRowCount: 2 })
      })
    });
  });

  it("restarts from the durable Dataset continuation without rematerializing or another source loop", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "restart-counts.csv");
    const sourceBytes = Buffer.from("name,count\nAda,3\nGrace,5\n", "utf8");
    fs.writeFileSync(sourceFile, sourceBytes);
    const models = createMutableModels(true);
    const planner = new StaticDatasetPlanner(csvPlan(sourceBytes));
    const datasetService = new DatasetService(planner);
    const firstSourceRuntime = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_inspect_dataset", args: {} },
        { kind: "text", text: "   " }
      ]
    });
    const firstJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(models, firstSourceRuntime, datasetCapabilities),
      undefined,
      undefined,
      undefined,
      datasetService
    );
    const firstHome = new HomeAgentService(
      fixture.vaultPort,
      models,
      neverRetrieval,
      firstJobs,
      firstSourceRuntime,
      datasetCapabilities,
      undefined,
      undefined,
      new DatasetQueryService(directDatasetExecutor)
    );
    const prepared = firstHome.prepareSourceTurn({
      text: "Which person has the largest count after restart?",
      inputKind: "file_drop",
      locale: "en"
    });
    await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_drop",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });
    expect(await firstHome.submitPreparedSourceTurn(prepared)).toMatchObject({
      state: "failed",
      error: { code: "model_provider.tool_protocol_incompatible" }
    });
    expect(firstJobs.readAgentTurnJob(prepared.jobId)).toMatchObject({
      state: "failed_retryable",
      stage: "planning",
      outputRefs: expect.arrayContaining([
        expect.objectContaining({ kind: "dataset", role: "agent_dataset" }),
        expect.objectContaining({ kind: "dataset_revision", role: "agent_dataset_revision" })
      ])
    });
    expect(planner.callCount).toBe(1);
    expect(firstHome.conversation())
      .toMatchObject({ canFollowUp: false, messages: [{ role: "user" }] });
    expect(firstJobs.retry({ jobId: prepared.jobId })).toMatchObject({ status: "requeued" });

    let sourceRuntimeCalls = 0;
    const restartedJobs = new JobsService(
      fixture.vaultPort,
      new AgentIngestService(models, {
        run: async () => {
          sourceRuntimeCalls += 1;
          throw new Error("A durable Dataset continuation must not re-enter source ingest.");
        }
      }, datasetCapabilities),
      undefined,
      undefined,
      undefined,
      datasetService
    );
    const restartedHome = new HomeAgentService(
      fixture.vaultPort,
      models,
      neverRetrieval,
      restartedJobs,
      new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
          { kind: "tool_call", toolName: "pige_inspect_dataset", args: {} },
          { kind: "tool_call", toolName: "pige_query_dataset", args: { action: "catalog" } },
          {
            kind: "tool_call",
            toolName: "pige_query_dataset",
            args: {
              action: "query",
              datasetRef: "dataset_1",
              tableRef: "table_1",
              select: ["column_1", "column_2"],
              orderBy: [{ by: "column_2", direction: "desc" }],
              limit: 2
            }
          },
          { kind: "text", text: "Grace remains the largest count after restart. [citation_9]" }
        ]
      }),
      datasetCapabilities,
      undefined,
      undefined,
      new DatasetQueryService(directDatasetExecutor)
    );

    expect(await restartedHome.resumeWaitingTurns(20)).toEqual({
      requeued: 0,
      processed: 1,
      completed: 1,
      waiting: 0,
      failed: 0
    });
    expect(sourceRuntimeCalls).toBe(0);
    expect(planner.callCount).toBe(1);
    expect(readJobs(fixture.vaultPath).filter((job) => job.class === "dataset_import")).toHaveLength(1);
    expect(restartedHome.conversation()?.messages.at(-1))
      .toMatchObject({
      role: "assistant",
      answer: expect.objectContaining({
        answer: "Grace remains the largest count after restart. [citation_9]",
        datasetResult: expect.objectContaining({ returnedRowCount: 2 })
      })
      });
    expect(await restartedHome.resumeWaitingTurns(20)).toEqual({
      requeued: 0,
      processed: 0,
      completed: 0,
      waiting: 0,
      failed: 0
    });
  });

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
        },
        { kind: "text", text: "The source was inspected and published." }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs, adapter);
    const prepared = home.prepareSourceTurn({
      inputKind: "file_drop",
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
      answer: { grounding: "general", citations: [] }
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
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "text", text: "The preserved source supports a direct answer." }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs, adapter);
    const prepared = home.prepareSourceTurn({
      text: "Summarize this without saving a note.",
      inputKind: "file_drop",
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
        grounding: "general",
        citations: []
      }
    });
    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toHaveLength(0);
    expect(listFiles(path.join(fixture.vaultPath, ".pige", "source-records"), ".json")).toHaveLength(1);
    expect(jobs.list({ limit: 20 }).jobs).toEqual([
      expect.objectContaining({ id: prepared.jobId, class: "agent_turn", state: "completed" })
    ]);
  });

  it("does not schedule a Host correction turn after provider prose stops the Pi loop", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "terminal-recovery-source.md");
    fs.writeFileSync(sourceFile, "# Recovery\n\nThe source remains bounded evidence.\n", "utf8");
    const models = createMutableModels(true);
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "text", text: "I inspected the source but stopped too early." },
        { kind: "text", text: "This later response must never run." }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs, adapter);
    const prepared = home.prepareSourceTurn({
      inputKind: "file_picker",
      locale: "en"
    });
    await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });

    const outcome = await home.submitPreparedSourceTurn(prepared);

    expect(outcome).toMatchObject({
      state: "completed",
      jobId: prepared.jobId,
      answer: { answer: "I inspected the source but stopped too early." }
    });
    expect(jobs.readAgentTurnJob(prepared.jobId)).toMatchObject({
      state: "completed"
    });
  });

  it("accepts provider prose after source inspection without a terminal action", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "terminal-missing-source.txt");
    fs.writeFileSync(sourceFile, "The source remains retryable when no terminal tool succeeds.\n", "utf8");
    const models = createMutableModels(true);
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "text", text: "Incomplete response without a terminal action." }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs, adapter);
    const prepared = home.prepareSourceTurn({
      inputKind: "file_drop",
      locale: "en"
    });
    await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_drop",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });

    const outcome = await home.submitPreparedSourceTurn(prepared);

    expect(outcome).toMatchObject({
      state: "completed",
      answer: { answer: "Incomplete response without a terminal action." }
    });
    expect(jobs.readAgentTurnJob(prepared.jobId)).toMatchObject({
      state: "completed"
    });
  });

  it("reconciles a crash after SourceRecord persistence and before Agent turn linkage", async () => {
    const fixture = makeVault();
    const sourceFile = path.join(path.dirname(fixture.vaultPath), "handoff-crash-source.txt");
    fs.writeFileSync(sourceFile, "The durable handoff must survive a restart boundary.\n", "utf8");
    const models = createMutableModels(true);
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "text", text: "The restarted turn reused its preserved source." }
      ]
    });
    const firstJobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, firstJobs, adapter);
    const prepared = home.prepareSourceTurn({
      text: "Read this after restart.",
      inputKind: "file_picker",
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
    const restartedHome = new HomeAgentService(
      fixture.vaultPort,
      models,
      neverRetrieval,
      restarted,
      adapter
    );
    expect(await restartedHome.resumeWaitingTurns(20)).toEqual({
      requeued: 0,
      processed: 1,
      completed: 1,
      waiting: 0,
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
        },
        { kind: "text", text: "The source was organized after the model became available." }
      ]
    });
    const jobs = new JobsService(fixture.vaultPort, new AgentIngestService(models, adapter));
    const home = new HomeAgentService(fixture.vaultPort, models, neverRetrieval, jobs, adapter);
    const prepared = home.prepareSourceTurn({
      inputKind: "file_picker",
      locale: "en"
    });
    await new CaptureService(fixture.vaultPort).preserveFilesForAgentTurn({
      filePaths: [sourceFile],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: prepared.jobId, sourceId: prepared.sourceId });
    const waiting = await home.submitPreparedSourceTurn(prepared);

    expect(waiting).toMatchObject({
      state: "waiting",
      modelUsage: "none",
      error: { code: "model_provider.default_model_missing" }
    });
    expect(jobs.list({ classes: ["agent_turn"] }).jobs).toEqual([
      expect.objectContaining({ id: waiting.jobId, state: "waiting_dependency", stage: "waiting_for_model" })
    ]);

    models.setReady(true);
    expect(jobs.requeueWaitingTextAgentTurns()).toEqual({ requeued: 1 });
    expect(await home.resumeWaitingTurns(20)).toEqual({
      requeued: 0,
      processed: 1,
      completed: 1,
      waiting: 0,
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
  search: (_request: RetrievalSearchRequest): RetrievalSearchResult => {
    throw new Error("Source-only unified ingress must not use the Home retrieval port.");
  },
  readExactSelectedEvidence: () => {
    throw new Error("Source-only unified ingress must not bind vault evidence.");
  }
};

const datasetCapabilities: AgentIngestCapabilityPort = {
  snapshot: () => ({
    localDatabaseStatus: "not_initialized",
    parserToolchainReady: false,
    datasetToolchainReady: true,
    ocrEngines: [],
    speechInputAvailable: false,
    embeddingModelInstalled: false,
    lexicalSearchAvailable: false,
    vectorSearchAvailable: false,
    rerankerAvailable: false
  })
};

const directDatasetExecutor: DatasetQueryExecutor = {
  execute: async (input) => executeDatasetQuery({
    ...input,
    schemaVersion: DATASET_QUERY_PROTOCOL_VERSION,
    requestId: "unified-agent-dataset-query"
  })
};

class StaticDatasetPlanner implements DatasetImportPlanner {
  callCount = 0;

  constructor(private readonly result: DatasetIngestPlan) {}

  isAvailable(): boolean {
    return true;
  }

  async plan(): Promise<DatasetIngestPlan> {
    this.callCount += 1;
    return this.result;
  }
}

function csvPlan(bytes: Buffer): DatasetIngestPlan {
  const values = [["Ada", "3"], ["Grace", "5"]];
  return {
    schemaVersion: 1,
    planner: { id: "dataset_ingest", version: "1" },
    source: {
      kind: "csv_file",
      byteLength: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      encoding: "utf-8",
      bom: false,
      delimiter: ",",
      quote: "\"",
      nullTokens: ["NULL", "\\N"],
      lineEndings: ["lf"]
    },
    target: {
      profile: "managed_collection",
      owner: "dataset_service",
      sourceDisposition: "preserve_as_evidence"
    },
    limits: {
      maxSourceBytes: 1024 * 1024,
      maxRows: 100,
      maxColumns: 10,
      maxCells: 1000,
      maxCellBytes: 1024,
      maxPlanValueBytes: 1024 * 1024,
      maxTables: 10,
      maxArchiveEntries: 100,
      maxArchiveUncompressedBytes: 1024 * 1024,
      maxXmlEntryBytes: 1024 * 1024,
      maxSelectedXmlBytes: 1024 * 1024
    },
    stats: { tableCount: 1, rowCount: 2, columnCount: 2, cellCount: 4, retainedValueBytes: 10 },
    tables: [{
      ordinal: 1,
      sourceName: "records",
      sourceLocator: "csv:table:1",
      sourceMetadata: { delimiter: "," },
      header: {
        mode: "auto",
        used: true,
        sourceRow: {
          ordinal: 0,
          sourceRow: 1,
          cells: [
            datasetCell(1, "csv.text", "name", { kind: "text", value: "name" }),
            datasetCell(2, "csv.text", "count", { kind: "text", value: "count" })
          ]
        }
      },
      columns: [
        {
          ordinal: 1,
          sourceName: "name",
          suggestedName: "name",
          projectedType: "text",
          sourceTypes: ["csv.text"],
          stats: { missing: 0, empty: 0, null: 0, value: 2 }
        },
        {
          ordinal: 2,
          sourceName: "count",
          suggestedName: "count",
          projectedType: "integer",
          sourceTypes: ["csv.integer"],
          stats: { missing: 0, empty: 0, null: 0, value: 2 }
        }
      ],
      rows: values.map((row, index) => ({
        ordinal: index + 1,
        sourceRow: index + 2,
        cells: [
          datasetCell(1, "csv.text", row[0]!, { kind: "text", value: row[0]! }),
          datasetCell(2, "csv.integer", row[1]!, { kind: "integer", value: row[1]! })
        ]
      }))
    }],
    warnings: []
  };
}

function datasetCell(
  columnOrdinal: number,
  sourceType: string,
  raw: string,
  projection: { readonly kind: "text" | "integer"; readonly value: string }
) {
  return {
    columnOrdinal,
    state: "value" as const,
    sourceType,
    lexical: { raw, text: raw, quoted: false },
    projection
  };
}

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

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a defined test value.");
  return value;
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  });
}
