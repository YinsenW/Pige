import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AgentRuntimeService,
  type AgentRuntimeModelPort,
  type AgentRuntimeVaultPort
} from "../../apps/desktop/src/main/services/agent-runtime-service";
import { LocalDatabaseService } from "../../apps/desktop/src/main/services/local-database-service";
import { createVaultOnDisk, loadVaultSummary } from "../../apps/desktop/src/main/services/vault-layout";
import type { ModelProfileSummary, ProviderProfileSummary, VaultSummary } from "@pige/contracts";

const tempRoots: string[] = [];

function makeVault(): { vaultPath: string; vault: VaultSummary } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-agent-runtime-test-"));
  tempRoots.push(root);
  createVaultOnDisk({
    parentDirectory: root,
    vaultName: "Runtime",
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp"),
    now: new Date("2026-07-09T12:00:00.000Z")
  });
  const vaultPath = path.join(root, "Runtime");
  return { vaultPath, vault: loadVaultSummary(vaultPath) };
}

function makeVaultPort(vaultPath: string | undefined, vault: VaultSummary | undefined): AgentRuntimeVaultPort {
  return {
    current: () => vault,
    activeVaultPath: () => vaultPath
  };
}

function makeModelPort(model: ModelProfileSummary | undefined): AgentRuntimeModelPort {
  const provider: ProviderProfileSummary | undefined = model
    ? {
        id: model.providerProfileId,
        displayName: "OpenAI",
        providerKind: "openai",
        modelListStrategy: "manual",
        cloudBoundary: "cloud",
        createdAt: "2026-07-09T00:00:00.000Z",
        updatedAt: "2026-07-09T00:00:00.000Z"
      }
    : undefined;

  return {
    getDefaultModel: () => model,
    getDefaultProvider: () => provider
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("agent runtime service", () => {
  it("blocks model jobs when no vault is active", () => {
    const service = new AgentRuntimeService(
      makeVaultPort(undefined, undefined),
      makeModelPort(undefined),
      new LocalDatabaseService()
    );

    const status = service.runtimeStatus();

    expect(status.state).toBe("blocked_no_vault");
    expect(status.canRunModelJobs).toBe(false);
    expect(status.missingDependencies).toEqual(["vault"]);
    expect(status.policySnapshot).toBeUndefined();
  });

  it("waits for a default model while still building a non-secret policy snapshot", () => {
    const { vaultPath, vault } = makeVault();
    const service = new AgentRuntimeService(
      makeVaultPort(vaultPath, vault),
      makeModelPort(undefined),
      new LocalDatabaseService()
    );

    const status = service.runtimeStatus();

    expect(status.state).toBe("waiting_for_model");
    expect(status.canRunModelJobs).toBe(false);
    expect(status.missingDependencies).toEqual(["default_model"]);
    expect(status.policySnapshot?.policyHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(JSON.stringify(status)).not.toContain(vaultPath);
  });

  it("becomes ready when a default model profile is available", () => {
    const { vaultPath, vault } = makeVault();
    const model: ModelProfileSummary = {
      id: "model_default",
      providerProfileId: "provider_default",
      modelId: "gpt-4.1",
      source: "manual",
      enabled: true,
      isDefault: true,
      createdAt: "2026-07-09T00:00:00.000Z",
      updatedAt: "2026-07-09T00:00:00.000Z"
    };
    const service = new AgentRuntimeService(
      makeVaultPort(vaultPath, vault),
      makeModelPort(model),
      new LocalDatabaseService()
    );

    const status = service.runtimeStatus();

    expect(status.state).toBe("ready");
    expect(status.canRunModelJobs).toBe(true);
    expect(status.defaultModelProfileId).toBe("model_default");
    expect(status.policySnapshot?.cloudBoundary).toBe("cloud");
  });
});
