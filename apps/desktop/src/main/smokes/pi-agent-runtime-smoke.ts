import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ModelProfileSummary, ProviderProfileSummary, RetrievalSearchResult } from "@pige/contracts";
import { HomeAgentService } from "../services/home-agent-service";
import { JobsService } from "../services/jobs-service";
import type { ModelProviderRuntimeConfig } from "../services/model-provider-registry";
import {
  createPigeTextToolResult,
  PiAgentRuntimeAdapter,
  type PigeAgentToolDescriptor
} from "../services/pi-agent-runtime-adapter";
import { createVaultOnDisk, loadVaultSummary } from "../services/vault-layout";

export async function runPiAgentRuntimeSmoke(): Promise<{
  readonly adapterMode: "embedded_pi_sdk";
  readonly modelId: string;
  readonly invokedTools: readonly string[];
  readonly publicationCount: number;
}> {
  let publicationCount = 0;
  const tools: PigeAgentToolDescriptor[] = [
    {
      ...SMOKE_TOOL_DESCRIPTOR,
      name: "pige_inspect_source",
      label: "Inspect",
      description: "Inspect synthetic evidence.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => createPigeTextToolResult(
        "Synthetic verified evidence.",
        { fragmentCount: 1 }
      )
    },
    {
      ...SMOKE_TOOL_DESCRIPTOR,
      capability: "write_generated_note",
      effect: "idempotent_write",
      outputTrust: "host_validated",
      name: "pige_create_knowledge_note",
      label: "Publish",
      description: "Publish a synthetic validated note.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
        additionalProperties: false
      },
      execute: async () => {
        publicationCount += 1;
        return createPigeTextToolResult("Published.", {});
      }
    }
  ];
  const result = await new PiAgentRuntimeAdapter({
    fauxResponses: [
      { kind: "tool_call", toolName: "pige_inspect_source", args: {} },
      { kind: "tool_call", toolName: "pige_create_knowledge_note", args: { title: "Smoke" } },
      { kind: "text", text: "The synthetic smoke evidence was inspected and published." }
    ]
  }).run({
    runtimeConfig,
    jobId: "job_20260711_pismoke01",
    systemPrompt: "Use only the two Pige-owned smoke tools.",
    userPrompt: "Inspect and publish the synthetic smoke evidence.",
    tools
  });
  return {
    adapterMode: result.adapterMode,
    modelId: result.modelId,
    invokedTools: result.invokedTools,
    publicationCount
  };
}

export async function runHomeAgentRuntimeSmoke(): Promise<{
  readonly state: "completed" | "waiting" | "failed";
  readonly answerMode?: "local_extractive" | "model_grounded";
  readonly citationCount: number;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-home-agent-smoke-"));
  try {
    createVaultOnDisk({
      parentDirectory: root,
      vaultName: "Home Smoke",
      appDataPath: path.join(root, "app-data"),
      tempPath: path.join(root, "temp"),
      now: new Date("2026-07-11T00:00:00.000Z")
    });
    const vaultPath = path.join(root, "Home Smoke");
    const vault = loadVaultSummary(vaultPath);
    writeHomeSmokePage(vaultPath);
    const vaults = { current: () => vault, activeVaultPath: () => vaultPath };
    const service = new HomeAgentService(
      vaults,
      {
        summary: () => ({
          presets: [],
          providers: [smokeProviderSummary],
          models: [smokeModelSummary],
          defaultModelProfileId: smokeModelSummary.id,
          hasDefaultModel: true,
          defaultBinding: {
            state: "ready",
            providerProfileId: smokeProviderSummary.id,
            modelProfileId: smokeModelSummary.id
          }
        }),
        getDefaultModel: () => smokeModelSummary,
        getDefaultProvider: () => smokeProviderSummary,
        hasDefaultRuntimeBinding: () => true,
        getDefaultRuntimeConfig: () => runtimeConfig
      },
      {
        search: () => createSmokeSearchResult(vault.vaultId),
        readExactSelectedEvidence: (result) => ({ items: result.results })
      },
      new JobsService(vaults),
      new PiAgentRuntimeAdapter({
        fauxResponses: [
          { kind: "tool_call", toolName: "pige_search_knowledge", args: {} },
          { kind: "text", text: "Smoke evidence is grounded. [1]" }
        ]
      })
    );
    const result = await service.submitTurn({
      schemaVersion: 1,
      text: "What does the smoke evidence say?",
      inputKind: "typed_text",
      objective: "vault_only",
      locale: "en"
    });
    return result.state === "completed"
      ? { state: result.state, answerMode: "model_grounded", citationCount: result.answer.citations.length }
      : { state: result.state, citationCount: 0 };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const SMOKE_TOOL_DESCRIPTOR = {
  version: "1",
  capability: "read_current_source",
  outputSchema: {
    type: "object",
    properties: {
      modelText: { type: "string" },
      details: { type: "object" },
      terminate: { type: "boolean" }
    },
    required: ["modelText", "details"],
    additionalProperties: false
  },
  effect: "read_only",
  inputTrust: "model_generated",
  outputTrust: "untrusted_source",
  dataBoundary: {
    resourceScope: "current_source",
    pathAuthority: "host_only",
    sourceIdAuthority: "host_only",
    modelAuthority: "none"
  },
  execution: "sequential",
  idempotency: { mode: "idempotent", scope: "current_source" },
  limits: { maxInputBytes: 1_024, maxOutputBytes: 32_768, timeoutMs: 10_000 },
  ownerService: "PiAgentRuntimeSmoke"
} as const;

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: {
    id: "provider_pi_smoke",
    displayName: "Pi Smoke",
    providerKind: "openai_compatible",
    endpointProtocol: "openai_responses",
    authRequirement: "api_key",
    baseUrl: "http://127.0.0.1:43123/v1",
    authSecretRef: "provider_secret_pi_smoke",
    modelListStrategy: "manual",
    cloudBoundary: "local",
    boundaryVerification: "loopback_verified",
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  model: {
    id: "model_pi_smoke",
    providerProfileId: "provider_pi_smoke",
    modelId: "pi-smoke-model",
    source: "manual",
    enabled: true,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z"
  },
  apiKey: "synthetic-smoke-key"
};

const smokeProviderSummary: ProviderProfileSummary = {
  id: runtimeConfig.provider.id,
  displayName: runtimeConfig.provider.displayName,
  providerKind: runtimeConfig.provider.providerKind,
  endpointProtocol: runtimeConfig.provider.endpointProtocol,
  authRequirement: runtimeConfig.provider.authRequirement,
  ...(runtimeConfig.provider.baseUrl ? { baseUrl: runtimeConfig.provider.baseUrl } : {}),
  modelListStrategy: runtimeConfig.provider.modelListStrategy,
  cloudBoundary: runtimeConfig.provider.cloudBoundary,
  ...(runtimeConfig.provider.boundaryVerification
    ? { boundaryVerification: runtimeConfig.provider.boundaryVerification }
    : {}),
  createdAt: runtimeConfig.provider.createdAt,
  updatedAt: runtimeConfig.provider.updatedAt
};

const smokeModelSummary: ModelProfileSummary = {
  id: runtimeConfig.model.id,
  providerProfileId: runtimeConfig.model.providerProfileId,
  modelId: runtimeConfig.model.modelId,
  ...(runtimeConfig.model.displayName ? { displayName: runtimeConfig.model.displayName } : {}),
  source: runtimeConfig.model.source,
  enabled: runtimeConfig.model.enabled,
  isDefault: true,
  createdAt: runtimeConfig.model.createdAt,
  updatedAt: runtimeConfig.model.updatedAt
};

const HOME_SMOKE_PAGE_ID = "page_20260711_homesmoke";

function createSmokeSearchResult(vaultId: string): RetrievalSearchResult {
  return {
    searchedAt: "2026-07-11T00:00:00.000Z",
    activeVaultId: vaultId,
    query: "What does the smoke evidence say?",
    mode: "lexical_sqlite_fts",
    total: 1,
    invalidPageCount: 0,
    degraded: false,
    results: [{
      summary: {
        pageId: HOME_SMOKE_PAGE_ID,
        title: "Home smoke",
        pageType: "note",
        status: "active",
        pagePath: "wiki/home-smoke.md",
        createdAt: "2026-07-11T00:00:00.000Z",
        updatedAt: "2026-07-11T00:00:00.000Z",
        sourceIds: []
      },
      score: 10,
      snippets: ["Smoke evidence is grounded."],
      matchReasons: ["body"]
    }]
  };
}

function writeHomeSmokePage(vaultPath: string): void {
  const pagePath = path.join(vaultPath, "wiki", "home-smoke.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.writeFileSync(pagePath, `---
id: "${HOME_SMOKE_PAGE_ID}"
schema_version: 1
title: "Home smoke"
type: "note"
created_at: "2026-07-11T00:00:00.000Z"
updated_at: "2026-07-11T00:00:00.000Z"
status: "active"
language: "en"
source_ids: []
---

Smoke evidence is grounded.
`, "utf8");
}
