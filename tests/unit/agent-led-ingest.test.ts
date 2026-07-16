import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { VaultSummary } from "@pige/contracts";
import type { JobRecord, OperationRecord, SourceRecord } from "@pige/schemas";
import {
  AgentIngestService,
  type AgentIngestModelConfigPort
} from "../../apps/desktop/src/main/services/agent-ingest-service";
import { CaptureService } from "../../apps/desktop/src/main/services/capture-service";
import { JobsService } from "../../apps/desktop/src/main/services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../../apps/desktop/src/main/services/model-provider-registry";
import { PiAgentRuntimeAdapter } from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import { markSourceAsLegacyAgentIngestFixture } from "../helpers/legacy-agent-ingest-fixture";

const roots: string[] = [];

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_agent_spine",
    displayName: "Agent Spine Faux Provider",
    providerKind: "openai_compatible",
    baseUrl: "http://127.0.0.1:43122/v1",
    authSecretRef: "provider_secret_agent_spine",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_agent_spine",
    providerProfileId: "provider_agent_spine",
    modelId: "agent-spine-model",
    displayName: "Agent Spine Model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-agent-spine-key"
};

const modelPort: AgentIngestModelConfigPort = {
  getDefaultModel: () => ({ ...runtimeConfig.model, isDefault: true }),
  getDefaultProvider: () => runtimeConfig.provider,
  hasDefaultRuntimeBinding: () => true,
  getDefaultRuntimeConfig: () => runtimeConfig
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Agent-led knowledge spine", () => {
  it("runs preserved text through the real Pi tool loop into validated durable knowledge", async () => {
    const fixture = makeVault();
    const network = installNetworkTripwire();
    try {
      const adapter = new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
          { kind: "tool_call", toolName: "pige_create_knowledge_note", args: groundedOutput("Agent-led knowledge") }
        ]
      });
      const jobs = new JobsService(
        fixture.vaultPort,
        new AgentIngestService(modelPort, adapter)
      );
      const capture = new CaptureService(fixture.vaultPort).submitText({
        text: "Pige preserves evidence before its Agent decides how to organize knowledge.",
        inputKind: "typed_text",
        userIntent: "capture",
        locale: "en"
      });
      markSourceAsLegacyAgentIngestFixture(fixture.vaultPath, capture.sourceId);

      expect(jobs.processQueuedCaptures({ jobIds: [capture.jobId] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });
      const agentJob = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["queued"] }).jobs[0]);
      expect(await jobs.processQueuedAgentIngest({ jobIds: [agentJob.id] })).toEqual({
        processed: 1,
        completed: 1,
        failed: 0
      });

      const completed = requireValue(jobs.list({ classes: ["agent_ingest"], states: ["completed"] }).jobs[0]);
      const notePath = requireValue(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")[0]);
      const note = fs.readFileSync(notePath, "utf8");
      const operations = readOperations(fixture.vaultPath);
      expect(completed.sourceId).toBe(capture.sourceId);
      expect(note).toContain("# Agent-led knowledge");
      expect(note).toContain(`model_profile_id: "${runtimeConfig.model.id}"`);
      expect(note).toContain(`[source:${capture.sourceId}#source]`);
      expect(fs.readFileSync(path.join(fixture.vaultPath, "index.md"), "utf8")).toContain("Agent-led knowledge");
      expect(fs.readFileSync(path.join(fixture.vaultPath, "log.md"), "utf8")).toContain(capture.sourceId);
      expect(operations.map((operation) => operation.kind)).toEqual(expect.arrayContaining([
        "model_egress_decision",
        "create_page"
      ]));
      expect(operations.find((operation) => operation.kind === "create_page")?.jobId).toBe(completed.id);
      expect(network.calls).toBe(0);
    } finally {
      network.restore();
    }
  });

  it("lets the real Pi loop replan after an unavailable tool without exposing a built-in capability", async () => {
    const fixture = makeVault();
    const capture = new CaptureService(fixture.vaultPort).submitText({
      text: "A missing optional parser should become a typed result, not shell access.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "bash", args: { command: "curl example.invalid" } },
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: groundedOutput("Replanned safely") }
      ]
    });
    const service = new AgentIngestService(modelPort, adapter);
    const source = readJsonBySuffix<SourceRecord>(fixture.vaultPath, ".pige/source-records", `${capture.sourceId}.json`);
    const job = readJsonBySuffix<JobRecord>(fixture.vaultPath, ".pige/jobs", `${capture.jobId}.json`);

    const result = await service.ingestSource(fixture.vaultPath, source, job);

    expect(result.title).toBe("Replanned safely");
    expect(fs.existsSync(path.join(fixture.vaultPath, result.pagePath))).toBe(true);
  });

  it("denies the durable knowledge tool before publication and preserves the source", async () => {
    const fixture = makeVault();
    const capture = new CaptureService(fixture.vaultPort).submitText({
      text: "Denied knowledge publication must leave preserved evidence intact.",
      inputKind: "typed_text",
      userIntent: "capture",
      locale: "en"
    });
    const adapter = new PiAgentRuntimeAdapter({
      fauxResponses: [
        { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
        { kind: "tool_call", toolName: "pige_create_knowledge_note", args: groundedOutput("Denied") },
        { kind: "text", text: "Publication was not authorized." }
      ]
    });
    const service = new AgentIngestService(
      modelPort,
      adapter,
      undefined,
      undefined,
      {
        authorize: (request) => request.capability === "read_current_source"
      }
    );
    const source = readJsonBySuffix<SourceRecord>(fixture.vaultPath, ".pige/source-records", `${capture.sourceId}.json`);
    const job = readJsonBySuffix<JobRecord>(fixture.vaultPath, ".pige/jobs", `${capture.jobId}.json`);

    await expect(service.ingestSource(fixture.vaultPath, source, job)).rejects.toMatchObject({
      code: "agent_runtime.knowledge_action_missing"
    });

    expect(listFiles(path.join(fixture.vaultPath, "wiki", "generated"), ".md")).toEqual([]);
    const preservedPath = requireValue(source.managedCopy?.path ?? source.original?.path);
    expect(fs.existsSync(path.join(fixture.vaultPath, preservedPath))).toBe(true);
    expect(readOperations(fixture.vaultPath).map((operation) => operation.kind)).toEqual(["model_egress_decision"]);
  });
});

function groundedOutput(title: string) {
  return {
    title,
    summary: { text: "Pige preserved the source before Agent planning.", evidenceRefs: ["ev_01"] },
    keyPoints: [{ text: "The source remains durable evidence.", evidenceRefs: ["ev_01"] }],
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-spine-"));
  roots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AgentSpine",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-11T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "AgentSpine");
  const vault = loadVaultSummary(vaultPath);
  return {
    vaultPath,
    vaultPort: { current: () => vault, activeVaultPath: () => vaultPath }
  };
}

function installNetworkTripwire(): { readonly calls: number; restore(): void } {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error("Unexpected network access in faux Pi vertical.");
  };
  return {
    get calls() { return calls; },
    restore: () => { globalThis.fetch = originalFetch; }
  };
}

function readOperations(vaultPath: string): OperationRecord[] {
  return listFiles(path.join(vaultPath, ".pige", "operations"), ".json")
    .map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")) as OperationRecord)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

function readJsonBySuffix<T>(vaultPath: string, relativeRoot: string, suffix: string): T {
  const filePath = requireValue(listFiles(path.join(vaultPath, relativeRoot), suffix)[0]);
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
}

function listFiles(root: string, suffix: string): string[] {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) return listFiles(filePath, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [filePath] : [];
  });
}

function requireValue<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected test value to exist.");
  return value;
}
