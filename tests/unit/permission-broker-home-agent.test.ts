import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  HomeAgentAskRequest,
  ModelProfileSummary,
  ProviderProfileSummary,
  RetrievalAskResult,
  RetrievalSearchResult,
  VaultSummary
} from "@pige/contracts";
import type { JobRecord } from "@pige/schemas";
import type { AgentIngestCapabilityPort } from "../../apps/desktop/src/main/services/agent-ingest-service";
import {
  HomeAgentService,
  type HomeAgentModelPort,
  type HomeAgentRetrievalPort
} from "../../apps/desktop/src/main/services/home-agent-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import {
  PermissionedExternalCapabilityRegistry,
  type PermissionedExternalCapabilityAdapter
} from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import { PiAgentRuntimeAdapter } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Permission Broker Home Agent integration", () => {
  it("pauses one real Pi tool turn, resumes the same Job after allow once, and executes exactly once", async () => {
    const fixture = makeFixture();
    const broker = new PermissionBrokerService({
      rootPath: fixture.appDataPath,
      assertWriterLease: () => undefined
    });
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      broker
    );
    let executeCalls = 0;
    const external = makeExternalAdapter(() => { executeCalls += 1; });
    const registry = new PermissionedExternalCapabilityRegistry([external], broker, jobs);
    const home = new HomeAgentService(
      fixture.vaults,
      makeModels(),
      makeRetrieval(fixture.vault.vaultId),
      jobs,
      new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: external.tool.name, args: { channel: "stable" } },
          {
            kind: "tool_call",
            toolName: "pige_finish_home_turn",
            args: {
              answer: "The external action completed after one explicit decision.",
              citationRefs: [],
              grounding: "general"
            }
          }
        ]
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );

    const first = await home.submitTurn({
      text: "Check the synthetic release channel.",
      inputKind: "typed_text",
      objective: "auto",
      locale: "en"
    });

    expect(first).toMatchObject({
      state: "waiting",
      error: {
        code: "permission.confirmation_required",
        permissionRequestId: expect.stringMatching(/^permreq_/u)
      }
    });
    expect(executeCalls).toBe(0);
    const requestId = first.error?.permissionRequestId;
    if (!requestId) throw new Error("Expected one pending Permission Broker request.");
    expect(jobs.pendingPermission(requestId)).toMatchObject({
      requestId,
      jobId: first.jobId,
      actorDisplayName: "Release Notes Skill",
      capability: "external_network",
      resourceCount: 1
    });
    expect(jobs.readAgentTurnJob(first.jobId)).toMatchObject({
      state: "waiting_permission",
      error: { permissionRequestId: requestId }
    });

    expect(jobs.resolvePermission({
      requestId,
      jobId: first.jobId,
      decision: "allow_once"
    })).toEqual({ status: "approved", requestId, jobId: first.jobId });
    expect(jobs.resolvePermission({
      requestId,
      jobId: first.jobId,
      decision: "allow_once"
    })).toEqual({ status: "approved", requestId, jobId: first.jobId });

    const resumed = await home.resumeWaitingTurns();
    expect(resumed).toMatchObject({ processed: 1, completed: 1, failed: 0, waiting: 0 });
    expect(executeCalls).toBe(1);
    expect(jobs.readAgentTurnJob(first.jobId)).toMatchObject({
      id: first.jobId,
      state: "completed",
      privacy: {
        usedNetwork: true,
        permissionDecisionIds: [expect.stringMatching(/^permdec_/u)]
      }
    });
    const timeline = home.conversation();
    expect(timeline?.messages.at(-1)).toMatchObject({
      role: "assistant",
      text: "The external action completed after one explicit decision."
    });
    expect(JSON.stringify(readJobs(fixture.vaultPath))).not.toContain("synthetic-external-body");
  });

  it("revalidates the exact runtime policy immediately before consuming authority or executing", async () => {
    const fixture = makeFixture();
    const broker = new PermissionBrokerService({
      rootPath: fixture.appDataPath,
      assertWriterLease: () => undefined
    });
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      broker
    );
    let policyChanged = false;
    let normalizeCalls = 0;
    let executeCalls = 0;
    const capabilities = capabilityPort(() => policyChanged);
    const external = makeExternalAdapter(
      () => { executeCalls += 1; },
      () => {
        normalizeCalls += 1;
        if (normalizeCalls === 2) policyChanged = true;
      }
    );
    const registry = new PermissionedExternalCapabilityRegistry([external], broker, jobs);
    const home = new HomeAgentService(
      fixture.vaults,
      makeModels(),
      makeRetrieval(fixture.vault.vaultId),
      jobs,
      new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: external.tool.name, args: { channel: "stable" } },
          {
            kind: "tool_call",
            toolName: "pige_finish_home_turn",
            args: { answer: "This answer must not be reached.", citationRefs: [], grounding: "general" }
          }
        ]
      }),
      capabilities,
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );

    const first = await home.submitTurn({
      text: "Check the synthetic release channel with a policy drift.",
      inputKind: "typed_text",
      objective: "auto",
      locale: "en"
    });
    const requestId = first.error?.permissionRequestId;
    if (!requestId) throw new Error("Expected one pending Permission Broker request.");
    jobs.resolvePermission({ requestId, jobId: first.jobId, decision: "allow_once" });

    await expect(home.resumeWaitingTurns()).resolves.toMatchObject({
      processed: 1,
      completed: 0,
      failed: 1,
      waiting: 0
    });
    expect(executeCalls).toBe(0);
    expect(broker.read(fixture.vaultPath, requestId).state).toBe("approved");
    expect(jobs.readAgentTurnJob(first.jobId)).toMatchObject({
      state: "failed_final",
      error: { code: "permission.binding_changed", retryable: false }
    });
  });

  it("terminalizes cancellation after one-use consumption as non-retryable completion uncertainty", async () => {
    const fixture = makeFixture();
    const broker = new PermissionBrokerService({
      rootPath: fixture.appDataPath,
      assertWriterLease: () => undefined
    });
    const jobs = new JobsService(
      fixture.vaults,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      broker
    );
    let activeJobId = "";
    let executeCalls = 0;
    const external = makeExternalAdapter((signal) => {
      executeCalls += 1;
      expect(jobs.cancel({ jobId: activeJobId }).status).toBe("cancel_requested");
      signal.throwIfAborted();
    });
    const registry = new PermissionedExternalCapabilityRegistry([external], broker, jobs);
    const home = new HomeAgentService(
      fixture.vaults,
      makeModels(),
      makeRetrieval(fixture.vault.vaultId),
      jobs,
      new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: external.tool.name, args: { channel: "stable" } },
          {
            kind: "tool_call",
            toolName: "pige_finish_home_turn",
            args: { answer: "This answer must not be reached.", citationRefs: [], grounding: "general" }
          }
        ]
      }),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );

    const first = await home.submitTurn({
      text: "Run one synthetic action that is cancelled after consumption.",
      inputKind: "typed_text",
      objective: "auto",
      locale: "en"
    });
    activeJobId = first.jobId;
    const requestId = first.error?.permissionRequestId;
    if (!requestId) throw new Error("Expected one pending Permission Broker request.");
    jobs.resolvePermission({ requestId, jobId: first.jobId, decision: "allow_once" });

    expect(await home.resumeWaitingTurns()).toMatchObject({
      processed: 1,
      completed: 0,
      failed: 1,
      waiting: 0
    });
    expect(executeCalls).toBe(1);
    const consumed = broker.read(fixture.vaultPath, requestId);
    expect(consumed.state).toBe("consumed");
    expect("completionMarkerHash" in consumed).toBe(false);
    expect(jobs.readAgentTurnJob(first.jobId)).toMatchObject({
      state: "failed_final",
      cancellation: { durableWritesApplied: true },
      error: {
        code: "permission.completion_uncertain",
        retryable: false,
        permissionRequestId: requestId
      }
    });
    expect(jobs.retry({ jobId: first.jobId }).status).toBe("not_allowed");
  });
});

function makeExternalAdapter(
  onExecute: (signal: AbortSignal) => void | Promise<void>,
  onNormalize: () => void = () => undefined
): PermissionedExternalCapabilityAdapter {
  const result = {
    modelText: JSON.stringify({ status: "available", channel: "stable" }),
    details: { status: "available" }
  } as const;
  return {
    tool: {
      name: "pige_fetch_release_notes",
      label: "Fetch release notes",
      description: "Read one bounded synthetic release-notes status through an injected external adapter.",
      parameters: {
        type: "object",
        properties: { channel: { type: "string", enum: ["stable"] } },
        required: ["channel"],
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
        required: ["status"],
        additionalProperties: false
      },
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: {
        resourceScope: "current_vault",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "current_vault" },
      limits: { maxInputBytes: 1_024, maxOutputBytes: 4_096, timeoutMs: 10_000 },
      ownerService: "PermissionBrokerHomeAgentTest"
    },
    actor: {
      type: "skill",
      id: "skill.release_notes",
      displayName: "Release Notes Skill",
      version: "1.0.0",
      digest: `sha256:${"a".repeat(64)}`
    },
    action: {
      id: "fetch.release_notes",
      version: "1",
      labelKey: "permissions.action.fetch_release_notes"
    },
    permission: {
      capability: "external_network",
      dataBoundary: "network",
      resourceScope: "current_action",
      resourceKind: "network",
      reasonCode: "external.release_notes"
    },
    normalizeInput: (input) => {
      onNormalize();
      return input;
    },
    resourceIdentity: () => ({ endpointId: "synthetic-release-notes" }),
    resourceCount: () => 1,
    execute: async (_input, signal) => {
      await onExecute(signal);
      return result;
    },
    adoptCompleted: async () => result
  };
}

function capabilityPort(policyChanged: () => boolean): AgentIngestCapabilityPort {
  return {
    snapshot: () => ({
      localDatabaseStatus: "ready",
      parserToolchainReady: false,
      ocrEngines: [],
      speechInputAvailable: false,
      embeddingModelInstalled: false,
      lexicalSearchAvailable: policyChanged(),
      vectorSearchAvailable: false,
      rerankerAvailable: false
    })
  };
}

function makeFixture(): {
  readonly vaultPath: string;
  readonly appDataPath: string;
  readonly vault: VaultSummary;
  readonly vaults: {
    current(): VaultSummary;
    activeVaultPath(): string;
    assertWriterLease(): void;
  };
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-permission-home-")));
  roots.push(root);
  const appDataPath = path.join(root, "app-data");
  fs.mkdirSync(appDataPath, { recursive: true });
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Permission Home",
    appDataPath,
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-14T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "Permission Home");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    appDataPath,
    vault,
    vaults: {
      current: () => vault,
      activeVaultPath: () => vaultPath,
      assertWriterLease: () => undefined
    }
  };
}

const provider: ProviderProfileSummary = {
  id: "provider_permission_home",
  presetId: "openai",
  displayName: "Synthetic Provider",
  providerKind: "openai",
  endpointProtocol: "openai_responses",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  boundaryVerification: "builtin_verified",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z"
};

const model: ModelProfileSummary = {
  id: "model_permission_home",
  providerProfileId: provider.id,
  modelId: "synthetic-permission-model",
  displayName: "Synthetic Permission Model",
  source: "provider_list",
  enabled: true,
  isDefault: true,
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z"
};

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: { ...provider, authSecretRef: "provider_secret_permission_home" },
  model,
  apiKey: "synthetic-permission-key"
};

function makeModels(): HomeAgentModelPort {
  return {
    summary: () => ({
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
    }),
    getDefaultModel: () => model,
    getDefaultProvider: () => provider,
    hasDefaultRuntimeBinding: () => true,
    getDefaultRuntimeConfig: () => runtimeConfig
  };
}

function makeRetrieval(vaultId: string): HomeAgentRetrievalPort {
  const search = (request: HomeAgentAskRequest): RetrievalSearchResult => ({
    searchedAt: "2026-07-14T00:00:00.000Z",
    activeVaultId: vaultId,
    query: request.query,
    mode: "lexical_sqlite_fts",
    total: 0,
    invalidPageCount: 0,
    degraded: false,
    results: []
  });
  return {
    search,
    ask: (request): RetrievalAskResult => ({
      requestId: "request_permission_home",
      state: "completed",
      result: {
        query: request.query,
        answerMode: "insufficient_evidence",
        answer: "No local evidence.",
        citations: [],
        warnings: ["no_relevant_local_evidence"]
      }
    })
  };
}

function readJobs(vaultPath: string): JobRecord[] {
  const root = path.join(vaultPath, ".pige", "jobs");
  return fs.readdirSync(root)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8")) as JobRecord);
}
