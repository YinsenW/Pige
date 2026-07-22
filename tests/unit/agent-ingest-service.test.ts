import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PigeDomainError } from "@pige/domain";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort,
  type AgentIngestPublicationBinding
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService, type SourceFetchPort } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import { KnowledgeActivityService } from "../../apps/desktop/src/main/services/knowledge-activity-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { OperationRecordSchema, type JobRecord, type OperationRecord, type SourceRecord } from "@pige/schemas";
import type { VaultSummary } from "@pige/contracts";
import { LegacyCaptureFixture } from "../helpers/legacy-capture-fixture";
import { ScriptedAgentIngestRuntime } from "../helpers/scripted-agent-ingest-runtime";

const tempRoots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_test",
    displayName: "Test Provider",
    providerKind: "openai",
    authSecretRef: "provider_secret_test",
    modelListStrategy: "manual",
    cloudBoundary: "cloud",
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  },
  model: {
    id: "model_test",
    providerProfileId: "provider_test",
    modelId: "test-model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-09T12:00:00.000Z",
    updatedAt: "2026-07-09T12:00:00.000Z"
  },
  apiKey: "sk-runtime-secret"
};

const verifiedLocalRuntimeConfig: ModelProviderRuntimeConfig = {
  ...runtimeConfig,
  provider: {
    ...runtimeConfig.provider,
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified"
  }
};

const verifiedLocalCompatibleRuntimeConfig: ModelProviderRuntimeConfig = {
  ...verifiedLocalRuntimeConfig,
  provider: {
    ...verifiedLocalRuntimeConfig.provider,
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:11434/v1"
  }
};

function makeModelPort(
  getConfig: () => ModelProviderRuntimeConfig | undefined = () => runtimeConfig
): AgentIngestModelConfigPort {
  return {
    getDefaultModel: () => {
      const config = getConfig();
      return config ? { ...config.model, isDefault: true } : undefined;
    },
    getDefaultProvider: () => getConfig()?.provider,
    hasDefaultRuntimeBinding: () => getConfig() !== undefined,
    getDefaultRuntimeConfig: getConfig
  };
}

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-ingest-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentIngest",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "AgentIngest");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeCapture(vaultPath: string, vault: VaultSummary, sourceFetch?: SourceFetchPort): LegacyCaptureFixture {
  return new LegacyCaptureFixture({
    current: () => vault,
    activeVaultPath: () => vaultPath
  }, vaultPath, sourceFetch);
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent ingest service", () => {
  it("checks model readiness without resolving runtime credentials", () => {
    let runtimeConfigReads = 0;
    expect(new AgentIngestService({
      getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
      getDefaultProvider: () => runtimeConfig.provider,
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        runtimeConfigReads += 1;
        return runtimeConfig;
      }
    }).hasDefaultModel()).toBe(true);
    expect(runtimeConfigReads).toBe(0);
    expect(new AgentIngestService(makeModelPort(() => undefined)).hasDefaultModel()).toBe(false);
    expect(new AgentIngestService({
      getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
      getDefaultProvider: () => runtimeConfig.provider,
      hasDefaultRuntimeBinding: () => false,
      getDefaultRuntimeConfig: () => undefined
    }).hasDefaultModel()).toBe(false);
  });

  it("prepares source tools for a Home-owned Pi turn without starting the legacy runtime", async () => {
    const { vaultPath, vault } = makeVault();
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const jobs = new JobsService(vaults);
    const job = jobs.createAgentTurnJob({
      conversationEventId: "evt_20260722_sourcesession",
      conversationLocator: ".pige/conversations/2026/07/conv_20260722.jsonl",
      inputHash: `sha256:${"a".repeat(64)}`,
      sourceExpected: true
    });
    if (!job.sourceId) throw new Error("Expected a source-bound Agent turn.");
    const sourcePath = path.join(path.dirname(vaultPath), "source.md");
    fs.writeFileSync(sourcePath, "# Source\n\nPrepare this source for Agent-selected knowledge work.\n", "utf8");
    await new CaptureService(vaults).preserveFilesForAgentTurn({
      filePaths: [sourcePath],
      inputKind: "file_picker",
      userIntent: "unknown",
      locale: "en"
    }, { jobId: job.id, sourceId: job.sourceId });
    jobs.attachAgentTurnSource(job.id, job.sourceId);
    const sourceRecord = readJson<SourceRecord>(findFile(
      path.join(vaultPath, ".pige/source-records"),
      `${job.sourceId}.json`
    ));
    const runtime = { run: vi.fn() };
    const service = new AgentIngestService(makeModelPort(), runtime);

    const session = await service.prepareSourceToolSession(vaultPath, sourceRecord, job);

    expect(runtime.run).not.toHaveBeenCalled();
    expect(session.tools.map((tool) => tool.name)).toContain("pige_inspect_source");
    expect(session.tools.map((tool) => tool.name)).not.toContain("pige_respond_to_user");
    await expect(session.beforeModelTurn()).resolves.toBeUndefined();
    expect(session.result()).toBeUndefined();
  });

  it("turns a preserved source into a wiki note, index entry, and operation record without storing prompts or secrets", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "API_KEY=sk-test-source-secret-12345\n\nPige should summarize local-first knowledge capture.",
      inputKind: "pasted_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Local-first capture",
      summary: { text: "Pige keeps source material local and compiles useful notes.", evidenceRefs: ["ev_01"] },
      keyPoints: [
        { text: "Preserve first", evidenceRefs: ["ev_01"] },
        { text: "Compile into Markdown", evidenceRefs: ["ev_01"] }
      ],
      tags: ["local-first", "capture"],
      topics: ["Knowledge management"],
      entities: ["Pige"],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(() => verifiedLocalRuntimeConfig), modelClient);

    const result = await service.ingestSource(vaultPath, sourceRecord, job);

    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");
    const index = fs.readFileSync(path.join(vaultPath, "index.md"), "utf8");
    const operations = readOperationFiles(vaultPath);
    const operation = requireOperation(operations, '"kind": "create_page"').text;

    expect(result.created).toBe(true);
    expect(result.reviewRequired).toBe(false);
    expect(result.warnings).toEqual([]);
    expect(note).toContain('type: "note"');
    expect(note).toContain('status: "active"');
    expect(note).toContain('review_state: "clean"');
    expect(note).toContain('model_profile_id: "model_test"');
    expect(note).toContain(`source_ids: ["${captured.sourceId}"]`);
    expect(note).toContain("Pige keeps source material local");
    expect(note).toContain(`[source:${captured.sourceId}#source]`);
    expect(index).toContain(`[Local-first capture](${result.pagePath})`);
    expect(operation).toContain('"kind": "create_page"');
    expect(operation).toContain('"policyAudit"');
    expect(operation).toMatch(/"policyHash": "sha256:[a-f0-9]{64}"/u);
    expect(operation).toContain(result.pagePath);
    expect((JSON.parse(operation) as OperationRecord).after).toEqual({
      kind: "page",
      id: `sha256:${createHash("sha256").update(note, "utf8").digest("hex")}`,
      path: result.pagePath
    });
    expect(operation).not.toContain("sk-test-source-secret");
    expect(operation).not.toContain("API_KEY");
    expect(result.operationIds).toHaveLength(1);
    expect(modelClient.lastUserPrompt).toContain("API_KEY=sk-test-source-secret-12345");
    expect(modelClient.lastUserPrompt).not.toContain("[redacted-secret]");

    const activity = new KnowledgeActivityService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    });
    expect(activity.list().activities.find((entry) => entry.operationId === result.operationId))
      .toMatchObject({ status: "applied", canUndo: true });
    expect(activity.undo({ operationId: result.operationId }).status).toBe("undone");
    expect(fs.existsSync(path.join(vaultPath, result.pagePath))).toBe(false);
    expect(activity.list().activities.find((entry) => entry.operationId === result.operationId))
      .toMatchObject({ status: "undone", canUndo: false });
  });

  it("never replaces an occupied deterministic create Operation with different audit facts", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Evidence for an append-only create Operation.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(
      path.join(vaultPath, ".pige/source-records"),
      `${captured.sourceId}.json`
    ));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Append-only evidence",
      summary: { text: "The durable Operation must not be replaced.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Keep the first audit identity", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    let occupiedPath: string | undefined;
    let occupiedBytes: string | undefined;
    const originalLink = fs.linkSync.bind(fs);
    const linkSpy = vi.spyOn(fs, "linkSync").mockImplementation((sourcePath, targetPath) => {
      const target = String(targetPath);
      const source = String(sourcePath);
      if (
        !occupiedPath &&
        target.endsWith(".json") &&
        path.basename(source).startsWith(`.${path.basename(target)}.`)
      ) {
        const operationId = path.basename(target, ".json");
        const occupied = OperationRecordSchema.parse({
          id: operationId,
          schemaVersion: 1,
          jobId: job.id,
          createdAt: "2026-07-12T00:00:00.000Z",
          actor: {
            kind: "pige_agent",
            runtimeKind: "desktop_local",
            clientCapabilityTier: "desktop_full"
          },
          kind: "create_page",
          targetRefs: [{
            kind: "page",
            id: "page_20260712_occupiedaudit",
            path: "wiki/generated/2026/page_20260712_occupiedaudit.md"
          }],
          sourceRefs: [{ kind: "job", id: job.id }],
          summary: "Pre-existing different create audit facts.",
          reversible: "best_effort",
          warnings: []
        });
        occupiedPath = target;
        occupiedBytes = `${JSON.stringify(occupied, null, 2)}\n`;
        fs.writeFileSync(target, occupiedBytes, "utf8");
      }
      return originalLink(sourcePath, targetPath);
    });

    try {
      await expect(new AgentIngestService(
        makeModelPort(() => verifiedLocalRuntimeConfig),
        modelClient
      ).ingestSource(vaultPath, sourceRecord, job)).rejects.toMatchObject({
        code: "agent_ingest.page_conflict"
      });
    } finally {
      linkSpy.mockRestore();
    }
    expect(occupiedPath).toBeDefined();
    expect(fs.readFileSync(occupiedPath as string, "utf8")).toBe(occupiedBytes);
  });

  it("sends a preserved source through the exact connected provider without a model-egress decision", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Ordinary source text for an endpoint whose data boundary is unknown.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const provider = { ...runtimeConfig.provider, cloudBoundary: "unknown" as const, boundaryVerification: "unknown" as const };
    let credentialLookups = 0;
    const modelClient = new CapturingModelClient(standardAgentOutput("Unknown-boundary source"));
    const service = new AgentIngestService({
      getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
      getDefaultProvider: () => provider,
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        credentialLookups += 1;
        return { ...runtimeConfig, provider };
      }
    }, modelClient);

    await expect(service.ingestSource(vaultPath, sourceRecord, job))
      .resolves.toMatchObject({ created: true });
    expect(credentialLookups).toBe(1);
    expect(modelClient.callCount).toBe(1);
    expect(modelClient.lastUserPrompt).toContain("Ordinary source text for an endpoint whose data boundary is unknown.");
    expect(modelClient.lastUserPrompt).not.toContain("cloud_boundary");
    expect(modelClient.lastUserPrompt).not.toContain("boundary_verification");
  });

  it("rejects a same-ID provider endpoint change before prompt rendering or credential lookup", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Evidence approved only for the planned loopback provider endpoint.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const changedProvider = {
      ...verifiedLocalCompatibleRuntimeConfig.provider,
      baseUrl: "http://localhost:11434/v1",
      updatedAt: "2026-07-09T12:01:00.000Z"
    };
    let providerReads = 0;
    let credentialLookups = 0;
    const modelClient = new CapturingModelClient({});
    const service = new AgentIngestService({
      getDefaultModel: () => ({ ...verifiedLocalCompatibleRuntimeConfig.model, isDefault: true }),
      getDefaultProvider: () => {
        providerReads += 1;
        return providerReads === 1 ? verifiedLocalCompatibleRuntimeConfig.provider : changedProvider;
      },
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        credentialLookups += 1;
        return { ...verifiedLocalCompatibleRuntimeConfig, provider: changedProvider };
      }
    }, modelClient);

    await expect(service.ingestSource(vaultPath, sourceRecord, job)).rejects.toMatchObject({
      code: "model_provider.runtime_config_changed"
    });
    expect(credentialLookups).toBe(0);
    expect(modelClient.callCount).toBe(0);
    expect(modelClient.lastUserPrompt).toBe("");
    expect(readOperationFiles(vaultPath)).toEqual([]);

    const changedRuntime = { ...verifiedLocalCompatibleRuntimeConfig, provider: changedProvider };
    const retryClient = new CapturingModelClient({
      title: "Endpoint-bound evidence",
      summary: { text: "The evidence is sent only after a fresh endpoint-bound decision.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    await new AgentIngestService(makeModelPort(() => changedRuntime), retryClient)
      .ingestSource(vaultPath, sourceRecord, job);
    expect(retryClient.lastUserPrompt).toContain("Evidence approved only for the planned loopback provider endpoint.");
  });

  it("rejects a same-ID runtime endpoint or model change before model invocation", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Evidence approved only for one concrete provider and model binding.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    let credentialLookups = 0;
    const modelClient = new CapturingModelClient({});
    const service = new AgentIngestService({
      getDefaultModel: () => ({ ...verifiedLocalCompatibleRuntimeConfig.model, isDefault: true }),
      getDefaultProvider: () => verifiedLocalCompatibleRuntimeConfig.provider,
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        credentialLookups += 1;
        return {
          ...verifiedLocalCompatibleRuntimeConfig,
          provider: {
            ...verifiedLocalCompatibleRuntimeConfig.provider,
            baseUrl: "http://localhost:11434/v1",
            updatedAt: "2026-07-09T12:01:00.000Z"
          },
          model: {
            ...verifiedLocalCompatibleRuntimeConfig.model,
            modelId: "different-model",
            updatedAt: "2026-07-09T12:01:00.000Z"
          }
        };
      }
    }, modelClient);

    await expect(service.ingestSource(vaultPath, sourceRecord, job)).rejects.toMatchObject({
      code: "model_provider.runtime_config_changed"
    });
    expect(credentialLookups).toBe(1);
    expect(modelClient.callCount).toBe(0);
    expect(modelClient.lastUserPrompt).toBe("");
  });

  it("omits unsafe Host metadata tokens without rewriting selected source evidence", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Ordinary evidence with a parser diagnostic that must be sanitized separately.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const storedSource = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const sourceRecord: SourceRecord = {
      ...storedSource,
      metadata: {
        ...storedSource.metadata,
        parserWarnings: ["api_key=sk-metadata-secret-123456789", "stable_parser_warning"]
      }
    };
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Sanitized metadata",
      summary: { text: "The evidence remains available after diagnostic sanitization.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });

    await new AgentIngestService(makeModelPort(() => verifiedLocalCompatibleRuntimeConfig), modelClient)
      .ingestSource(vaultPath, sourceRecord, job);

    expect(modelClient.lastUserPrompt).toContain("policy_context_id: policy_");
    expect(modelClient.lastUserPrompt).toMatch(/policy_hash: sha256:[a-f0-9]{64}/u);
    expect(modelClient.lastUserPrompt).toContain("stable_parser_warning");
    expect(modelClient.lastUserPrompt).not.toContain("sk-metadata-secret");
    expect(modelClient.lastUserPrompt).not.toContain("[redacted-secret]");
  });

  it("omits non-token parser diagnostics and still runs the selected provider", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Ordinary evidence whose parser diagnostic contains forbidden credential material.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const storedSource = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const sourceRecord: SourceRecord = {
      ...storedSource,
      metadata: {
        ...storedSource.metadata,
        parserWarnings: ["-----BEGIN PRIVATE KEY----- never-send-this"]
      }
    };
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    let credentialLookups = 0;
    const modelClient = new CapturingModelClient(standardAgentOutput("Safe metadata projection"));
    const service = new AgentIngestService({
      getDefaultModel: () => ({ ...verifiedLocalCompatibleRuntimeConfig.model, isDefault: true }),
      getDefaultProvider: () => verifiedLocalCompatibleRuntimeConfig.provider,
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        credentialLookups += 1;
        return verifiedLocalCompatibleRuntimeConfig;
      }
    }, modelClient);

    await expect(service.ingestSource(vaultPath, sourceRecord, job)).resolves.toMatchObject({ created: true });
    expect(credentialLookups).toBe(1);
    expect(modelClient.callCount).toBe(1);
    expect(modelClient.lastUserPrompt).not.toContain("PRIVATE KEY");
  });

  it("sends accepted secret-like source text unchanged without a model-egress Operation", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "-----BEGIN PRIVATE KEY-----\nnot-safe-to-send\n-----END PRIVATE KEY-----",
      inputKind: "pasted_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    let credentialLookups = 0;
    const modelClient = new CapturingModelClient(standardAgentOutput("Exact source pass-through"));
    const service = new AgentIngestService({
      getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
      getDefaultProvider: () => runtimeConfig.provider,
      hasDefaultRuntimeBinding: () => true,
      getDefaultRuntimeConfig: () => {
        credentialLookups += 1;
        return runtimeConfig;
      }
    }, modelClient);

    await expect(service.ingestSource(vaultPath, sourceRecord, job)).resolves.toMatchObject({ created: true });
    expect(credentialLookups).toBe(1);
    expect(modelClient.lastUserPrompt).toContain("-----BEGIN PRIVATE KEY-----\nnot-safe-to-send\n-----END PRIVATE KEY-----");
  });

  it("marks low-confidence or warning-bearing generated notes as needing review", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "Thin source with uncertain details.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Uncertain note",
      summary: { text: "The source may be too thin for a confident note.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Needs human review", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: ["Source evidence is thin."],
      confidence: "low"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const result = await service.ingestSource(vaultPath, sourceRecord, job);
    const repeated = await service.ingestSource(vaultPath, sourceRecord, job);

    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");
    const operation = requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').text;

    expect(result.reviewRequired).toBe(true);
    expect(result.warnings).toEqual(["Source evidence is thin."]);
    expect(repeated.created).toBe(false);
    expect(repeated.reviewRequired).toBe(true);
    expect(note).toContain('status: "needs_review"');
    expect(note).toContain('review_state: "needs_review"');
    expect(note).toContain('confidence: "low"');
    expect(note).toContain("## Warnings");
    expect(note).toContain("Source evidence is thin.");
    expect(operation).toContain("Source evidence is thin.");
    expect(operation).not.toContain("Thin source with uncertain details.");
  });

  it("is idempotent for an already-created wiki note", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "A reusable source.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Reusable source",
      summary: { text: "One generated note is enough.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Idempotent", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "medium"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const first = await service.ingestSource(vaultPath, sourceRecord, job);
    const operationPath = requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').path;
    fs.rmSync(operationPath);
    fs.writeFileSync(path.join(vaultPath, "index.md"), "# Index\n", "utf8");
    const checkpoints: string[] = [];
    const second = await service.ingestSource(vaultPath, sourceRecord, job, {
      onPublicationStart: (checkpointId) => checkpoints.push(checkpointId)
    });
    const recoveredOperation = requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').text;
    const recoveredIndex = fs.readFileSync(path.join(vaultPath, "index.md"), "utf8");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.pagePath).toBe(first.pagePath);
    expect(second.operationId).toBe(first.operationId);
    expect(recoveredOperation).toContain("Recovered operation metadata");
    expect((JSON.parse(recoveredOperation) as OperationRecord).after).toBeUndefined();
    expect(recoveredIndex).toContain(`[Reusable source](${first.pagePath})`);
    expect(checkpoints).toEqual(["agent_existing_note_adoption_started"]);
    expect(modelClient.callCount).toBe(1);
    expect(new KnowledgeActivityService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    }).list().activities.find((activity) => activity.operationId === first.operationId))
      .toMatchObject({ canUndo: false, undoUnavailableReason: "legacy_record" });
  });

  it("recovers a checksum-bound create Operation that remains safely undoable", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "A crash-safe generated note must retain its exact expected checksum.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(
      path.join(vaultPath, ".pige/source-records"),
      `${captured.sourceId}.json`
    ));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Crash-safe note",
      summary: { text: "The expected checksum is durable before publication.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);
    let binding: AgentIngestPublicationBinding | undefined;
    const first = await service.ingestSource(vaultPath, sourceRecord, job, {
      onPublicationStart: (_checkpointId, publicationBinding) => {
        binding = publicationBinding;
      }
    });
    const notePath = path.join(vaultPath, first.pagePath);
    const note = fs.readFileSync(notePath, "utf8");
    expect(binding).toEqual(expect.objectContaining({
      sourceId: sourceRecord.id,
      pageId: first.pageId,
      pagePath: first.pagePath,
      contentHash: checksumText(note),
      sourceRevisionHash: checksumText(JSON.stringify(sourceRecord)),
      policyContextId: expect.any(String),
      policyHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      operationId: first.operationId,
      operationPath: expect.stringMatching(/^\.pige\/operations\//u)
    }));
    fs.rmSync(requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').path);
    fs.writeFileSync(path.join(vaultPath, "index.md"), "# Index\n", "utf8");
    const publicationBinding = requireValue(binding);
    const recoveryJob = {
      ...job,
      policyContextId: publicationBinding.policyContextId,
      policyHash: publicationBinding.policyHash,
      checkpoints: [createPublicationCheckpoint(job, publicationBinding)]
    } satisfies JobRecord;

    const recovered = await service.ingestSource(vaultPath, sourceRecord, recoveryJob);
    const repeated = await service.ingestSource(vaultPath, sourceRecord, recoveryJob);
    const operation = OperationRecordSchema.parse(JSON.parse(
      requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').text
    ));
    const activity = new KnowledgeActivityService({
      current: () => vault,
      activeVaultPath: () => vaultPath
    });

    expect(recovered.created).toBe(false);
    expect(repeated.operationId).toBe(recovered.operationId);
    expect(readOperationFiles(vaultPath).filter((item) => item.text.includes('"kind": "create_page"')))
      .toHaveLength(1);
    expect(operation.after).toEqual({
      kind: "page",
      id: publicationBinding.contentHash,
      path: first.pagePath
    });
    expect(operation.policyAudit).toEqual({
      policyContextId: publicationBinding.policyContextId,
      policyHash: publicationBinding.policyHash,
      enforcementOwners: ["Agent Orchestrator", "Model Provider Registry"]
    });
    expect(operation.summary).toContain(publicationBinding.sourceRevisionHash);
    expect(activity.list().activities.find((item) => item.operationId === operation.id))
      .toMatchObject({ canUndo: true });
    expect(activity.undo({ operationId: operation.id }).status).toBe("undone");
    expect(fs.existsSync(notePath)).toBe(false);
    expect(modelClient.callCount).toBe(1);
  });

  it("does not attest externally edited generated bytes during crash recovery", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "External edits after publication must never be retroactively signed.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(
      path.join(vaultPath, ".pige/source-records"),
      `${captured.sourceId}.json`
    ));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "External edit guard",
      summary: { text: "Only exact committed bytes may be adopted.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);
    let binding: AgentIngestPublicationBinding | undefined;
    const first = await service.ingestSource(vaultPath, sourceRecord, job, {
      onPublicationStart: (_checkpointId, publicationBinding) => {
        binding = publicationBinding;
      }
    });
    fs.rmSync(requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').path);
    const notePath = path.join(vaultPath, first.pagePath);
    fs.appendFileSync(notePath, "\nUser-authored recovery-window edit.\n", "utf8");
    const publicationBinding = requireValue(binding);
    const recoveryJob = {
      ...job,
      policyContextId: publicationBinding.policyContextId,
      policyHash: publicationBinding.policyHash,
      checkpoints: [createPublicationCheckpoint(job, publicationBinding)]
    } satisfies JobRecord;

    await expect(service.ingestSource(vaultPath, sourceRecord, recoveryJob))
      .rejects.toMatchObject({ code: "agent_ingest.page_conflict" });

    expect(fs.readFileSync(notePath, "utf8")).toContain("User-authored recovery-window edit.");
    expect(readOperationFiles(vaultPath).some((operation) => operation.text.includes('"kind": "create_page"')))
      .toBe(false);
    expect(modelClient.callCount).toBe(1);
  });

  it("attributes existing notes by bounded last-job provenance and guards only new index adoption", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Existing-note provenance must stay bounded to its actual publishing job.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const originalJob = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Bounded provenance note",
      summary: { text: "The note belongs to one exact publishing job.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);
    const first = await service.ingestSource(vaultPath, sourceRecord, originalJob);
    const notePath = path.join(vaultPath, first.pagePath);
    const otherJob: JobRecord = { ...originalJob, id: "job_20260710_otherjob01" };

    const otherJobCheckpoints: string[] = [];
    await service.ingestSource(vaultPath, sourceRecord, otherJob, {
      onPublicationStart: (checkpointId) => otherJobCheckpoints.push(checkpointId)
    });
    expect(otherJobCheckpoints).toEqual([]);

    fs.writeFileSync(path.join(vaultPath, "index.md"), "# Index\n", "utf8");
    const indexAdoptionCheckpoints: string[] = [];
    await service.ingestSource(vaultPath, sourceRecord, otherJob, {
      onPublicationStart: (checkpointId) => indexAdoptionCheckpoints.push(checkpointId)
    });
    expect(indexAdoptionCheckpoints).toEqual(["agent_index_publication_started"]);

    const legacyNote = fs.readFileSync(notePath, "utf8")
      .replace(/^  last_job_id:.*\n/mu, "");
    fs.writeFileSync(notePath, legacyNote, "utf8");
    const legacyJob: JobRecord = { ...originalJob, id: "job_20260710_legacyjob1" };
    const legacyCheckpoints: string[] = [];
    await service.ingestSource(vaultPath, sourceRecord, legacyJob, {
      onPublicationStart: (checkpointId) => legacyCheckpoints.push(checkpointId)
    });
    expect(legacyCheckpoints).toEqual([]);
    expect(modelClient.callCount).toBe(1);
  });

  it("rechecks source evidence at the final generated-note commit boundary", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Evidence that changes immediately before note commit must not be written.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Stale note",
      summary: { text: "This response became stale before commit.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    let currentChecks = 0;
    const fenceEvents: string[] = [];

    await expect(new AgentIngestService(makeModelPort(), modelClient).ingestSource(
      vaultPath,
      sourceRecord,
      job,
      {
        assertSourceCurrent: () => {
          currentChecks += 1;
          fenceEvents.push(`source-${currentChecks}`);
          if (currentChecks === 7) {
            throw new PigeDomainError("agent_ingest.source_changed", "Source evidence changed at commit.");
          }
        },
        onPublicationStart: (checkpointId) => fenceEvents.push(checkpointId)
      }
    )).rejects.toMatchObject({ code: "agent_ingest.source_changed" });

    expect(currentChecks).toBe(7);
    expect(fenceEvents).toEqual([
      "source-1",
      "source-2",
      "source-3",
      "source-4",
      "source-5",
      "source-6",
      "agent_note_publication_started",
      "source-7"
    ]);
    expect(listFiles(path.join(vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    expect(readOperationFiles(vaultPath).some((operation) => operation.text.includes('"kind": "create_page"'))).toBe(false);
  });

  it("preserves a user page created while the model call is running", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "A concurrent user page must remain authoritative.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const notePath = generatedNoteFilePath(vaultPath, captured.sourceId);
    const userPage = [
      "---",
      'title: "User page"',
      `source_ids: ["${captured.sourceId}"]`,
      "example: |",
      '  generated_by: "pige"',
      '  model_profile_id: "model_test"',
      "---",
      "",
      "# User page",
      "",
      "This example in the user-authored body is not ownership metadata:",
      "",
      "```yaml",
      "provenance:",
      '  generated_by: "pige"',
      `source_ids: ["${captured.sourceId}"]`,
      "```",
      "",
      "Do not replace this edit.",
      ""
    ].join("\n");
    const modelClient = new CapturingModelClient({
      title: "Generated replacement",
      summary: { text: "This must not replace the user page.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    }, () => {
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.writeFileSync(notePath, userPage, "utf8");
    });

    await expect(new AgentIngestService(makeModelPort(), modelClient).ingestSource(
      vaultPath,
      sourceRecord,
      job
    )).rejects.toMatchObject({ code: "agent_ingest.page_conflict" });

    expect(fs.readFileSync(notePath, "utf8")).toBe(userPage);
    expect(fs.readFileSync(path.join(vaultPath, "index.md"), "utf8")).not.toContain(path.basename(notePath));
    expect(readOperationFiles(vaultPath).some((operation) => operation.text.includes('"kind": "create_page"'))).toBe(false);
  });

  it("recovers a same-source Pige note committed concurrently without replacing it", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Concurrent processing of one source should converge on one generated note.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const notePath = generatedNoteFilePath(vaultPath, captured.sourceId);
    const concurrentNote = [
      "---",
      'title: "Concurrent winner"',
      'type: "note"',
      `source_ids: ["${captured.sourceId}"]`,
      "provenance:",
      '  generated_by: "pige"',
      '  model_profile_id: "model_test"',
      "note:",
      '  review_state: "clean"',
      "---",
      "",
      "# Concurrent winner",
      "",
      "This durable note won the create race.",
      ""
    ].join("\n");
    const modelClient = new CapturingModelClient({
      title: "Losing generated note",
      summary: { text: "This response must not replace the concurrent winner.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    }, () => {
      fs.mkdirSync(path.dirname(notePath), { recursive: true });
      fs.writeFileSync(notePath, concurrentNote, "utf8");
    });

    const result = await new AgentIngestService(makeModelPort(), modelClient).ingestSource(
      vaultPath,
      sourceRecord,
      job
    );

    expect(result.created).toBe(false);
    expect(result.title).toBe("Concurrent winner");
    expect(result.operationIds).toHaveLength(1);
    expect(modelClient.callCount).toBe(1);
    expect(fs.readFileSync(notePath, "utf8")).toBe(concurrentNote);
    expect(fs.readFileSync(path.join(vaultPath, "index.md"), "utf8"))
      .toContain(`[Concurrent winner](${result.pagePath})`);
    expect(requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').text)
      .toContain("Recovered operation metadata");
  });

  it.skipIf(process.platform === "win32")("rejects a symlinked generated-note parent without writing outside the vault", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Generated notes must stay inside the active vault.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-note-outside-"));
    tempRoots.push(outside);
    const generatedRoot = path.join(vaultPath, "wiki", "generated");
    fs.rmSync(generatedRoot, { recursive: true, force: true });
    fs.symlinkSync(outside, generatedRoot, "dir");
    const modelClient = new CapturingModelClient({
      title: "Unsafe note",
      summary: { text: "This must not cross the vault boundary.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });

    await expect(new AgentIngestService(makeModelPort(), modelClient).ingestSource(
      vaultPath,
      sourceRecord,
      job
    )).rejects.toMatchObject({ code: "agent_ingest.page_conflict" });

    expect(modelClient.callCount).toBe(0);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("uses extracted text instead of raw HTML for URL source prompts", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault, {
      fetchSnapshot: async () => ({
        originalUrl: "https://example.com/article?token=secret-token",
        finalUrl: "https://example.com/article?token=secret-token",
        contentType: "text/html",
        title: "URL Prompt Source",
        extraction: {
          parserId: "mozilla_readability",
          engine: "@mozilla/readability+jsdom",
          version: "0.6.0+29.1.1",
          mode: "readability",
          textCharacterCount: 36,
          elementCount: 12,
          truncated: false
        },
        rawContent: "<html><script>ignore()</script><body>Raw HTML shell</body></html>",
        extractedText: "Readable article text for the model.",
        warnings: ["instruction_like_source_text"]
      })
    });
    const captured = await capture.submitUrl({
      url: "https://example.com/article?token=secret-token",
      inputKind: "pasted_url",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "URL note",
      summary: { text: "The model received extracted URL text.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Uses extracted text", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "medium"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    await service.ingestSource(vaultPath, sourceRecord, job);

    expect(modelClient.lastUserPrompt).toContain("Readable article text for the model.");
    expect(modelClient.lastUserPrompt).toContain("web_extraction_mode: readability");
    expect(modelClient.lastUserPrompt).toContain('extraction_warnings: ["instruction_like_source_text"]');
    expect(modelClient.lastUserPrompt).not.toContain("<script>");
    expect(modelClient.lastUserPrompt).not.toContain("secret-token");
  });

  it("reads the actual extracted artifact size and carries artifact locators into the prompt", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "tiny",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const artifactPath = `artifacts/extracted-text/2026/07/${captured.sourceId}.txt`;
    const metadataPath = `artifacts/metadata/2026/07/${captured.sourceId}.docx.json`;
    const artifactText = "This extracted artifact is much longer than the compressed or tiny managed source and must be read in full.";
    writeVaultFile(vaultPath, artifactPath, artifactText);
    const metadataText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_docx_metadata",
      sourceId: captured.sourceId,
      kind: "docx_parse_metadata",
      extractedTextChecksum: checksumText(artifactText),
      units: [
        { locator: "block:1", characterStart: 0, characterEnd: 48 },
        { locator: "block:2", characterStart: 48, characterEnd: artifactText.length }
      ]
    });
    writeVaultFile(vaultPath, metadataPath, metadataText);
    const enrichedSource: SourceRecord = {
      ...sourceRecord,
      artifacts: [
        {
          id: "art_docx_text",
          kind: "extracted_text",
          path: artifactPath,
          checksum: checksumText(artifactText),
          size: Buffer.byteLength(artifactText)
        },
        {
          id: "art_docx_metadata",
          kind: "metadata",
          path: metadataPath,
          checksum: checksumText(metadataText),
          size: Buffer.byteLength(metadataText)
        }
      ]
    };
    const modelClient = new CapturingModelClient({
      title: "Artifact note",
      summary: { text: "The complete bounded artifact was available.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Artifact size is independent from source size", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    await service.ingestSource(vaultPath, enrichedSource, job);

    expect(modelClient.lastUserPrompt).toContain("must be read in full");
    expect(modelClient.lastUserPrompt).toContain('evidence_artifact_ids: ["art_docx_text"]');
    expect(modelClient.lastUserPrompt).toContain('"locator":"block:1"');
    expect(modelClient.lastUserPrompt).toContain('"locator":"block:2"');
    expect(modelClient.lastUserPrompt).toContain('artifact_id="art_docx_text"');
  });

  it("carries OCR evidence locators into the prompt and forces review for low-confidence truncated OCR", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const imagePath = path.join(path.dirname(vaultPath), "ocr-evidence.png");
    fs.writeFileSync(imagePath, Buffer.from("synthetic-image-source"));
    const captured = await capture.submitFiles({
      filePaths: [imagePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    const jobId = requireFirst(captured.jobIds);
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${jobId}.json`));
    const artifactPath = `artifacts/ocr/2026/07/${sourceId}.txt`;
    const metadataPath = `artifacts/metadata/2026/07/${sourceId}.ocr.json`;
    const artifactText = "OCR evidence recovered from the preserved image.";
    const metadataText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_ocr_metadata",
      sourceId,
      kind: "image_ocr_metadata",
      ocrTextChecksum: checksumText(artifactText),
      units: [{
        locator: "ocr:block:1",
        characterStart: 0,
        characterEnd: artifactText.length,
        boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 },
        confidence: 0.41
      }]
    });
    writeVaultFile(vaultPath, artifactPath, artifactText);
    writeVaultFile(vaultPath, metadataPath, metadataText);
    const ocrSource: SourceRecord = {
      ...sourceRecord,
      artifacts: [{
        id: "art_ocr_evidence",
        kind: "ocr",
        path: artifactPath,
        checksum: checksumText(artifactText),
        size: Buffer.byteLength(artifactText)
      }, {
        id: "art_ocr_metadata",
        kind: "metadata",
        path: metadataPath,
        checksum: checksumText(metadataText),
        size: Buffer.byteLength(metadataText)
      }],
      metadata: {
        ...sourceRecord.metadata,
        needsOcr: false,
        ocrEngine: "macos_vision_document",
        ocrConfidence: 0.41,
        ocrWarnings: ["ocr_output_truncated"]
      }
    };
    const modelClient = new CapturingModelClient({
      title: "OCR evidence note",
      summary: { text: "The image contains locally recognized evidence.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "The text came from local OCR", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const result = await service.ingestSource(vaultPath, ocrSource, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");

    expect(result.reviewRequired).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(note).toContain('confidence: "medium"');
    expect(note).toContain('status: "needs_review"');
    expect(note).toContain("Local OCR confidence is low");
    expect(note).toContain("Local OCR output reached a processing limit");
    expect(modelClient.lastUserPrompt).toContain("OCR evidence recovered from the preserved image.");
    expect(modelClient.lastUserPrompt).toContain("ocr_engine: macos_vision_document");
    expect(modelClient.lastUserPrompt).toContain("ocr_confidence: 0.41");
    expect(modelClient.lastUserPrompt).toContain('ocr_warnings: ["ocr_output_truncated"]');
    expect(modelClient.lastUserPrompt).toContain('evidence_artifact_ids: ["art_ocr_evidence"]');
    expect(modelClient.lastUserPrompt).toContain('"locator":"ocr:block:1"');
  });

  it("renders claim-level citations from combined native and supplemental OCR artifacts", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "preserved placeholder",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const pageOne = "Native page one evidence.";
    const pageTwo = "Native page two evidence.";
    const headerOne = "--- Page 1 ---\n";
    const headerTwo = "--- Page 2 ---\n";
    const nativeText = `${headerOne}${pageOne}\n\n${headerTwo}${pageTwo}`;
    const pageOneStart = headerOne.length;
    const pageTwoStart = headerOne.length + pageOne.length + 2 + headerTwo.length;
    const ocrText = "A diagram contributes supplemental OCR evidence.";
    const nativePath = `artifacts/extracted-text/2026/07/${captured.sourceId}.pdf.txt`;
    const nativeMetadataPath = `artifacts/metadata/2026/07/${captured.sourceId}.pdf.json`;
    const ocrPath = `artifacts/ocr/2026/07/${captured.sourceId}.pdf.txt`;
    const ocrMetadataPath = `artifacts/metadata/2026/07/${captured.sourceId}.pdf-ocr.json`;
    const nativeChecksum = checksumText(nativeText);
    const ocrChecksum = checksumText(ocrText);
    const nativeMetadataText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_mixed_native_metadata",
      sourceId: captured.sourceId,
      kind: "pdf_parse_metadata",
      extractedTextChecksum: nativeChecksum,
      pages: [
        { locator: "page:1", characterStart: pageOneStart, characterEnd: pageOneStart + pageOne.length },
        { locator: "page:2", characterStart: pageTwoStart, characterEnd: pageTwoStart + pageTwo.length }
      ]
    });
    const ocrMetadataText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_mixed_ocr_metadata",
      sourceId: captured.sourceId,
      kind: "pdf_page_ocr_metadata",
      ocrTextChecksum: ocrChecksum,
      units: [{
        locator: "page:2/ocr:block:1",
        parentLocator: "page:2",
        characterStart: 0,
        characterEnd: ocrText.length,
        confidence: 0.94
      }]
    });
    writeVaultFile(vaultPath, nativePath, nativeText);
    writeVaultFile(vaultPath, nativeMetadataPath, nativeMetadataText);
    writeVaultFile(vaultPath, ocrPath, ocrText);
    writeVaultFile(vaultPath, ocrMetadataPath, ocrMetadataText);
    const mixedSource: SourceRecord = {
      ...sourceRecord,
      kind: "pdf_file",
      artifacts: [{
        id: "art_mixed_ocr_text",
        kind: "ocr",
        path: ocrPath,
        checksum: ocrChecksum,
        size: Buffer.byteLength(ocrText)
      }, {
        id: "art_mixed_native_metadata",
        kind: "metadata",
        path: nativeMetadataPath,
        checksum: checksumText(nativeMetadataText),
        size: Buffer.byteLength(nativeMetadataText)
      }, {
        id: "art_mixed_native_text",
        kind: "extracted_text",
        path: nativePath,
        checksum: nativeChecksum,
        size: Buffer.byteLength(nativeText)
      }, {
        id: "art_mixed_ocr_metadata",
        kind: "metadata",
        path: ocrMetadataPath,
        checksum: checksumText(ocrMetadataText),
        size: Buffer.byteLength(ocrMetadataText)
      }],
      metadata: { ...sourceRecord.metadata, needsOcr: false, ocrConfidence: 0.94, ocrWarnings: [] }
    };
    const modelClient = new CapturingModelClient({
      title: "Mixed PDF evidence",
      summary: { text: "The PDF contains native evidence on two pages.", evidenceRefs: ["ev_01", "ev_02"] },
      keyPoints: [{ text: "A diagram adds OCR evidence.", evidenceRefs: ["ev_03"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });

    const result = await new AgentIngestService(makeModelPort(), modelClient).ingestSource(vaultPath, mixedSource, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");
    const operation = requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').text;

    expect(modelClient.lastUserPrompt).toContain('"ref":"ev_01"');
    expect(modelClient.lastUserPrompt).toContain('"ref":"ev_02"');
    expect(modelClient.lastUserPrompt).toContain('"ref":"ev_03"');
    expect(note).toContain(`[source:${captured.sourceId}#p1]`);
    expect(note).toContain(`[source:${captured.sourceId}#p2]`);
    expect(note).toContain(`[source:${captured.sourceId}#p2-ocr1]`);
    expect(operation).toContain('"id": "art_mixed_native_text"');
    expect(operation).toContain('"id": "art_mixed_ocr_text"');
    expect(operation).not.toContain(pageOne);
    expect(operation).not.toContain(ocrText);
  });

  it("renders PPTX embedded-media OCR citations with slide and media provenance", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "preserved PPTX placeholder",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const body = "Screenshot-only roadmap evidence.";
    const header = "--- Slide 1 Media 1 ---\n";
    const text = `${header}${body}`;
    const textPath = `artifacts/ocr/2026/07/${captured.sourceId}.pptx-media.txt`;
    const metadataPath = `artifacts/metadata/2026/07/${captured.sourceId}.pptx-media-ocr.json`;
    const textChecksum = checksumText(text);
    const metadataText = JSON.stringify({
      schemaVersion: 1,
      artifactId: "art_pptx_media_ocr_metadata",
      sourceId: captured.sourceId,
      kind: "pptx_media_ocr_metadata",
      ocrTextChecksum: textChecksum,
      units: [{
        locator: "slide:1/media:1/ocr:block:1",
        parentLocator: "slide:1",
        characterStart: header.length,
        characterEnd: header.length + body.length,
        confidence: 0.95
      }]
    });
    writeVaultFile(vaultPath, textPath, text);
    writeVaultFile(vaultPath, metadataPath, metadataText);
    const pptxSource: SourceRecord = {
      ...sourceRecord,
      kind: "pptx_file",
      artifacts: [{
        id: "art_pptx_media_ocr_text",
        kind: "ocr",
        path: textPath,
        checksum: textChecksum,
        size: Buffer.byteLength(text)
      }, {
        id: "art_pptx_media_ocr_metadata",
        kind: "metadata",
        path: metadataPath,
        checksum: checksumText(metadataText),
        size: Buffer.byteLength(metadataText)
      }],
      metadata: { ...sourceRecord.metadata, needsOcr: false, ocrConfidence: 0.95, ocrWarnings: [] }
    };
    const modelClient = new CapturingModelClient({
      title: "PPTX screenshot evidence",
      summary: { text: "The slide screenshot contains roadmap evidence.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "The roadmap is visible only in embedded media.", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });

    const result = await new AgentIngestService(makeModelPort(), modelClient).ingestSource(vaultPath, pptxSource, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");
    const operation = requireOperation(readOperationFiles(vaultPath), '"kind": "create_page"').text;

    expect(modelClient.lastUserPrompt).toContain('locator="slide:1/media:1/ocr:block:1"');
    expect(note).toContain(`[source:${captured.sourceId}#slide1-media1-ocr1]`);
    expect(operation).toContain('"id": "art_pptx_media_ocr_text"');
    expect(operation).not.toContain(body);
  });

  it("refuses a changed extracted artifact before any model call", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "managed source",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const artifactPath = `artifacts/extracted-text/2026/07/${captured.sourceId}.txt`;
    const originalText = "Verified extracted text.";
    writeVaultFile(vaultPath, artifactPath, originalText);
    const changedSource: SourceRecord = {
      ...sourceRecord,
      artifacts: [{
        id: "art_verified_text",
        kind: "extracted_text",
        path: artifactPath,
        checksum: checksumText(originalText),
        size: Buffer.byteLength(originalText)
      }]
    };
    fs.appendFileSync(path.join(vaultPath, artifactPath), " changed");
    const modelClient = new CapturingModelClient({
      title: "Should not run",
      summary: { text: "Should not run.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "low"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    await expect(service.ingestSource(vaultPath, changedSource, job)).rejects.toThrow("recorded size");
    expect(modelClient.callCount).toBe(0);
  });

  it("refuses preserved documents without extracted text instead of sending binary content to the model", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const sourcePath = path.join(path.dirname(vaultPath), "paper.pdf");
    fs.writeFileSync(sourcePath, Buffer.from("%PDF-1.7\nBinary-looking content must stay out of prompts."));
    const captured = await capture.submitFiles({
      filePaths: [sourcePath],
      inputKind: "file_drop",
      userIntent: "capture",
      locale: "en"
    });
    const sourceId = requireFirst(captured.sourceIds);
    const jobId = requireFirst(captured.jobIds);
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Should not run",
      summary: { text: "This output should never be requested.", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "low"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    await expect(service.ingestSource(vaultPath, sourceRecord, job)).rejects.toThrow("No source text is available");

    expect(modelClient.callCount).toBe(0);
    expect(modelClient.lastUserPrompt).toBe("");
  });

  it("forces review when parser coverage is truncated or still waiting for OCR", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "A bounded extracted preview that must not be described as the complete visible document.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const qualityLimitedSource: SourceRecord = {
      ...sourceRecord,
      metadata: {
        ...sourceRecord.metadata,
        parserFormat: "pdf",
        textCoverage: "medium",
        parserTruncated: true,
        needsOcr: true,
        parserWarnings: ["Only the configured leading page range was processed."]
      }
    };
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Bounded document note",
      summary: { text: "The available excerpt describes a bounded source.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Coverage is partial", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const result = await service.ingestSource(vaultPath, qualityLimitedSource, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");

    expect(result.reviewRequired).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(note).toContain('confidence: "medium"');
    expect(note).toContain('status: "needs_review"');
    expect(note).toContain("leading page range");
    expect(note).toContain("OCR enrichment");
    expect(modelClient.lastUserPrompt).toContain("parser_truncated: true");
    expect(modelClient.lastUserPrompt).toContain("ocr_enrichment_pending: true");
    expect(modelClient.lastUserPrompt).not.toContain("Only the configured leading page range was processed.");
  });

  it("forces review when web extraction is truncated or reduced to the basic fallback", async () => {
    const { vaultPath, vault } = makeVault();
    const capture = makeCapture(vaultPath, vault);
    const captured = capture.submitText({
      text: "A bounded web extraction that may still contain navigation around the useful article body.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const reducedWebSource: SourceRecord = {
      ...sourceRecord,
      metadata: {
        ...sourceRecord.metadata,
        webExtraction: {
          parserId: "pige_basic_html",
          engine: "pige_domless_fallback",
          version: "1",
          mode: "regex_fallback",
          textCharacterCount: 84,
          truncated: true
        },
        extractionWarnings: ["readability_worker_failed", "extracted_text_truncated"]
      }
    };
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Bounded web note",
      summary: { text: "The available extraction describes part of a web page.", evidenceRefs: ["ev_01"] },
      keyPoints: [{ text: "Coverage is partial", evidenceRefs: ["ev_01"] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const result = await service.ingestSource(vaultPath, reducedWebSource, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");

    expect(result.reviewRequired).toBe(true);
    expect(result.warnings).toHaveLength(2);
    expect(note).toContain('confidence: "medium"');
    expect(note).toContain("reached the local extraction limit");
    expect(note).toContain("reduced web extraction");
    expect(modelClient.lastUserPrompt).toContain("web_extraction_mode: regex_fallback");
    expect(modelClient.lastUserPrompt).toContain("web_extraction_truncated: true");
  });

  it("omits an unknown evidence ref without failing the durable knowledge action", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "Only this local statement is available as evidence.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Unsupported claim",
      summary: { text: "An unsupported assertion.", evidenceRefs: ["ev_99"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const result = await service.ingestSource(vaultPath, sourceRecord, job);

    expect(modelClient.callCount).toBe(1);
    expect(result.reviewRequired).toBe(true);
    expect(result.warnings).toEqual([
      expect.stringMatching(/^One or more generated claims have no verified evidence citation/u)
    ]);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");
    expect(note).not.toContain("ev_99");
  });

  it("forces review for uncited statements without inventing a fallback citation", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "A statement is available, but the model omitted its evidence refs.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Uncited note",
      summary: { text: "The model omitted support.", evidenceRefs: [] },
      keyPoints: [{ text: "This point also lacks support.", evidenceRefs: [] }],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });
    const service = new AgentIngestService(makeModelPort(), modelClient);

    const result = await service.ingestSource(vaultPath, sourceRecord, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");

    expect(result.reviewRequired).toBe(true);
    expect(result.warnings.join(" ")).toContain("no verified evidence citation");
    expect(note).toContain('confidence: "medium"');
    expect(note).not.toContain(`[source:${captured.sourceId}#`);
  });

  it("strips model-authored citation syntax and renders only resolved evidence refs", async () => {
    const { vaultPath, vault } = makeVault();
    const captured = makeCapture(vaultPath, vault).submitText({
      text: "The preserved fact is local-first capture.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const sourceRecord = readJson<SourceRecord>(findFile(path.join(vaultPath, ".pige/source-records"), `${captured.sourceId}.json`));
    const job = readJson<JobRecord>(findFile(path.join(vaultPath, ".pige/jobs"), `${captured.jobId}.json`));
    const modelClient = new CapturingModelClient({
      title: "Verified citation",
      summary: { text: "Local-first capture is preserved. [source:src_20260710_fake#p9]", evidenceRefs: ["ev_01"] },
      keyPoints: [],
      tags: [],
      topics: [],
      entities: [],
      warnings: [],
      confidence: "high"
    });

    const result = await new AgentIngestService(makeModelPort(), modelClient).ingestSource(vaultPath, sourceRecord, job);
    const note = fs.readFileSync(path.join(vaultPath, result.pagePath), "utf8");

    expect(note).not.toContain("src_20260710_fake");
    expect(note).toContain(`[source:${captured.sourceId}#source]`);
  });
});

class CapturingModelClient extends ScriptedAgentIngestRuntime {
  constructor(
    output: unknown,
    onGenerate?: () => void
  ) {
    super(output, onGenerate);
  }

  get lastUserPrompt(): string {
    return this.userPrompt;
  }
}

function generatedNoteFilePath(vaultPath: string, sourceId: string): string {
  const dateKey = /^src_(\d{8})_/.exec(sourceId)?.[1];
  if (!dateKey) throw new Error("Expected a dated Source ID.");
  const pageId = `page_${dateKey}_${createHash("sha256").update(`wiki-note:${sourceId}`).digest("hex").slice(0, 12)}`;
  return path.join(vaultPath, "wiki", "generated", dateKey.slice(0, 4), `${pageId}.md`);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function readOperationFiles(vaultPath: string): Array<{ readonly path: string; readonly text: string }> {
  return listFiles(path.join(vaultPath, ".pige", "operations"), ".json")
    .map((filePath) => ({ path: filePath, text: fs.readFileSync(filePath, "utf8") }));
}

function requireOperation(
  operations: readonly { readonly path: string; readonly text: string }[],
  marker: string
): { readonly path: string; readonly text: string } {
  const operation = operations.find((candidate) => candidate.text.includes(marker));
  if (!operation) throw new Error(`Missing operation containing ${marker}`);
  return operation;
}

function standardAgentOutput(title: string): unknown {
  return {
    title,
    summary: { text: "Grounded Agent output for a pass-through test.", evidenceRefs: ["ev_01"] },
    keyPoints: [],
    tags: [],
    topics: [],
    entities: [],
    warnings: [],
    confidence: "high"
  };
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(fullPath, suffix) : entry.isFile() && entry.name.endsWith(suffix) ? [fullPath] : [];
  });
}

function writeVaultFile(vaultPath: string, relativePath: string, value: string): void {
  const filePath = path.join(vaultPath, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, "utf8");
}

function checksumText(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function createPublicationCheckpoint(
  job: JobRecord,
  binding: AgentIngestPublicationBinding
): NonNullable<JobRecord["checkpoints"]>[number] {
  if (!job.sourceId) throw new Error("The publication checkpoint fixture requires a source-bound Job.");
  return {
    id: "agent_note_publication_started",
    step: "agent_note_publication_started",
    state: "running",
    startedAt: "2026-07-10T12:00:00.000Z",
    inputRefs: [
      {
        kind: "source",
        id: job.sourceId,
        checksum: binding.sourceRevisionHash,
        role: "publication_source_revision"
      },
      {
        kind: "tool",
        id: binding.policyContextId,
        checksum: binding.policyHash,
        role: "publication_policy"
      }
    ],
    outputRefs: [
      {
        kind: "page",
        id: binding.pageId,
        path: binding.pagePath,
        checksum: binding.contentHash,
        role: "expected_generated_note"
      },
      {
        kind: "operation",
        id: binding.operationId,
        path: binding.operationPath,
        role: "expected_create_operation"
      }
    ],
    checksumAfter: binding.contentHash,
    resumeHint: "Verify the exact generated-note bytes before adopting its create Operation."
  };
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected a test value.");
  return value;
}

function findFile(root: string, suffix: string): string {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  throw new Error(`Missing file ending with ${suffix}`);
}

function findFileOptional(root: string, suffix: string): string | undefined {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFileOptional(fullPath, suffix);
      if (found) return found;
    }
    if (entry.isFile() && entry.name.endsWith(suffix)) {
      return fullPath;
    }
  }
  return undefined;
}

function requireFirst(values: readonly string[]): string {
  const first = values[0];
  if (!first) throw new Error("Expected at least one value.");
  return first;
}

async function waitForValue<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for the test state.");
}
