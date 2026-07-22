import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ModelProfileSummary,
  ProviderProfileSummary,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  VaultSummary
} from "@pige/contracts";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
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

describe("AR1 submitted-turn authority in Home", () => {
  it("completes an ordinary first-party tool turn with zero permission records or waiting state", async () => {
    const fixture = makeFixture();
    const confirmations = new HighRiskConfirmationService();
    const broker = new PermissionBrokerService({
      rootPath: fixture.appDataPath,
      assertWriterLease: () => undefined,
      confirmations
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
    const execute = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "release channel available" }],
      details: { status: "available" }
    }));
    const external = makeFirstPartyAdapter(execute);
    const registry = new PermissionedExternalCapabilityRegistry([external], broker, jobs);
    const home = new HomeAgentService(
      fixture.vaults,
      makeModels(),
      makeRetrieval(fixture.vault.vaultId),
      jobs,
      new PiAgentRuntimeAdapter({ fauxResponses: [
        { kind: "tool_call", toolName: external.tool.name, args: { channel: "stable" } },
        {
          kind: "tool_call",
          toolName: "pige_finish_home_turn",
          args: {
            answer: "The ordinary first-party action completed.",
            citationRefs: [],
            grounding: "general"
          }
        }
      ] }),
      undefined,
      undefined,
      undefined,
      undefined,
      registry
    );

    const result = await home.submitTurn({
      text: "Check the stable release channel.",
      inputKind: "typed_text",
      objective: "auto",
      locale: "en",
      clientTurnId: "turn_20260722_homeauthority"
    });

    expect(result, JSON.stringify(result)).toMatchObject({
      state: "completed",
      answer: { answer: "The ordinary first-party action completed." }
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(confirmations.pending()).toMatchObject({ status: "none" });
    expect(jobs.readAgentTurnJob(result.jobId)).toMatchObject({
      state: "completed",
      privacy: { usedNetwork: true }
    });
  });

  it("keeps a denied high-risk effect out of the adapter and out of Job permission state", async () => {
    const fixture = makeFixture();
    const confirmations = new HighRiskConfirmationService();
    const broker = new PermissionBrokerService({
      rootPath: fixture.appDataPath,
      assertWriterLease: () => undefined,
      confirmations
    });
    const execute = vi.fn(async () => ({ content: [{ type: "text" as const, text: "must not run" }] }));
    const external = makeHighRiskAdapter(execute);
    const registry = new PermissionedExternalCapabilityRegistry([external], broker);
    const tool = registry.toolsForTurn({
      vaultPath: fixture.vaultPath,
      vaultId: fixture.vault.vaultId,
      jobId: "job_20260722_highrisk01",
      policyContextId: "policy_context_highrisk",
      policyHash: digest("high risk policy"),
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full",
      confirmationOwner: { kind: "agent_turn", clientTurnId: "turn_20260722_highriskabcd" },
      assertCurrent: vi.fn()
    })[0];
    if (!tool) throw new Error("Expected high-risk tool.");
    const signal = new AbortController().signal;
    const context = { toolCallId: "tool_call_highrisk", signal };

    const execution = tool.execute({}, signal, context);
    const pending = confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected confirmation.");
    await confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "deny"
    });
    await expect(execution).rejects.toMatchObject({ code: "permission.denied" });
    expect(execute).toHaveBeenCalledTimes(0);
  });
});

function makeFirstPartyAdapter(execute: PermissionedExternalCapabilityAdapter["execute"]): PermissionedExternalCapabilityAdapter {
  return baseAdapter({ actorType: "local_tool", actorId: "local_tool.pige.node_os_readonly", execute });
}

function makeHighRiskAdapter(execute: PermissionedExternalCapabilityAdapter["execute"]): PermissionedExternalCapabilityAdapter {
  return baseAdapter({
    actorType: "skill",
    actorId: "skill.external.shell",
    execute,
    highRisk: {
      effect: "arbitrary_shell",
      presentation: {
        action: "run_shell_command",
        target: "local_system",
        subject: { kind: "executable_name", value: "lark-cli" }
      }
    }
  });
}

function baseAdapter(input: {
  actorType: "skill" | "local_tool";
  actorId: string;
  execute: PermissionedExternalCapabilityAdapter["execute"];
  highRisk?: PermissionedExternalCapabilityAdapter["permission"]["highRisk"];
}): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: input.actorType === "local_tool" ? "pige_read_release_channel" : "pige_external_shell",
      label: "Synthetic capability",
      description: "One bounded synthetic capability.",
      parameters: input.actorType === "local_tool"
        ? {
            type: "object",
            properties: { channel: { type: "string" } },
            required: ["channel"],
            additionalProperties: false
          }
        : { type: "object", properties: {}, additionalProperties: false },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
        additionalProperties: false
      },
      effect: "read_only",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: { resourceScope: "current_vault", pathAuthority: "host_only", sourceIdAuthority: "host_only", modelAuthority: "none" },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 1024, maxOutputBytes: 4096, timeoutMs: 10000 },
      ownerService: "PermissionBrokerHomeAgentTest"
    },
    actor: {
      type: input.actorType,
      id: input.actorId,
      displayName: "Synthetic capability",
      version: "1.0.0",
      digest: digest(input.actorId)
    },
    action: { id: "synthetic.execute", version: "1", labelKey: "permissions.action.synthetic" },
    permission: {
      capability: input.actorType === "local_tool" ? "external_network" : "run_shell",
      dataBoundary: input.actorType === "local_tool" ? "network" : "local",
      resourceScope: "current_action",
      reasonCode: "synthetic.execute",
      ...(input.highRisk ? { highRisk: () => input.highRisk! } : {})
    },
    normalizeInput: (value) => value,
    resourceIdentity: () => ({ identity: "synthetic" }),
    resourceDisplayName: () => "lark-cli",
    resourceCount: () => 1,
    execute: input.execute
  };
}

function makeFixture(): {
  vaultPath: string;
  appDataPath: string;
  vault: VaultSummary;
  vaults: { current(): VaultSummary; activeVaultPath(): string; assertWriterLease(): void };
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ar1-home-")));
  roots.push(root);
  const appDataPath = path.join(root, "app-data");
  fs.mkdirSync(appDataPath, { recursive: true });
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "AR1 Home",
    appDataPath,
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-22T00:00:00.000Z")
  });
  const vaultPath = path.join(root, "AR1 Home");
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
  id: "provider_ar1_home",
  presetId: "openai",
  displayName: "Synthetic Provider",
  providerKind: "openai",
  endpointProtocol: "openai_responses",
  modelListStrategy: "list_models",
  cloudBoundary: "cloud",
  boundaryVerification: "builtin_verified",
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z"
};

const model: ModelProfileSummary = {
  id: "model_ar1_home",
  providerProfileId: provider.id,
  modelId: "synthetic-ar1-model",
  displayName: "Synthetic AR1 Model",
  source: "provider_list",
  enabled: true,
  isDefault: true,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T00:00:00.000Z"
};

const runtimeConfig: ModelProviderRuntimeConfig = {
  provider: { ...provider, authSecretRef: "provider_secret_ar1_home" },
  model,
  apiKey: "synthetic-key"
};

function makeModels(): HomeAgentModelPort {
  return {
    summary: () => ({
      presets: [], providers: [provider], models: [model], defaultModelProfileId: model.id,
      hasDefaultModel: true,
      defaultBinding: { state: "ready", providerProfileId: provider.id, modelProfileId: model.id }
    }),
    getDefaultModel: () => model,
    getDefaultProvider: () => provider,
    hasDefaultRuntimeBinding: () => true,
    getDefaultRuntimeConfig: () => runtimeConfig
  };
}

function makeRetrieval(vaultId: string): HomeAgentRetrievalPort {
  const search = (request: RetrievalSearchRequest): RetrievalSearchResult => ({
    searchedAt: "2026-07-22T00:00:00.000Z",
    activeVaultId: vaultId,
    query: request.query,
    mode: "lexical_sqlite_fts",
    total: 0,
    invalidPageCount: 0,
    degraded: false,
    results: []
  });
  return { search };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
