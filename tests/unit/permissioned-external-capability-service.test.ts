import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import {
  PermissionedExternalCapabilityRegistry,
  type PermissionedExternalCapabilityAdapter,
  type PermissionedExternalJobPort,
  type PermissionedExternalTurnContext
} from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import type {
  PigeAgentToolCallContext,
  PigeAgentToolDefinition,
  PigeAgentToolResult
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";
import { createVaultOnDisk } from "../../apps/desktop/src/main/services/vault-layout";

const VAULT_ID = "vault_20260714_external01";
const JOB_ID = "job_20260714_external01";
const PRIVATE_BODY = "SYNTHETIC_EXTERNAL_PRIVATE_BODY_DO_NOT_PERSIST";
const TOOL_RESULT: PigeAgentToolResult = {
  content: [{ type: "text", text: "Synthetic external result." }],
  details: { status: "ok", receipt: "synthetic-receipt" }
};
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionedExternalCapabilityRegistry", () => {
  it("keeps the production-default capability registry empty without a Broker dependency", () => {
    const registry = new PermissionedExternalCapabilityRegistry();
    expect(registry.toolNames()).toEqual([]);
    expect(registry.toolsForTurn({
      vaultPath: "/synthetic/not-read",
      vaultId: VAULT_ID,
      jobId: JOB_ID,
      policyContextId: "policy_context_external_test",
      policyHash: digest("external policy"),
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full",
      assertCurrent: vi.fn()
    })).toEqual([]);
  });

  it("never invokes the adapter when the exact external action is denied", async () => {
    const fixture = createFixture();
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    await expect(callTool(tool)).rejects.toMatchObject({
      code: "permission.confirmation_required"
    });
    const pending = requireRecord(fixture.broker.listForJob(fixture.vaultPath, JOB_ID));
    const denied = fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "deny"
    });

    expect(denied.lifecycle).toMatchObject({ state: "denied", decision: "deny" });
    expect(fixture.execute).toHaveBeenCalledTimes(0);
    expect(fixture.jobs.consumptions).toHaveLength(0);
    expect(fixture.jobs.completions).toHaveLength(0);
  });

  it("executes one allow-once action exactly once and adopts its completion after restart", async () => {
    const fixture = createFixture();
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    await expect(callTool(tool)).rejects.toMatchObject({
      code: "permission.confirmation_required"
    });
    const pending = requireRecord(fixture.broker.listForJob(fixture.vaultPath, JOB_ID));
    expect(readMachineJson(fixture.machineRoot)).not.toContain(PRIVATE_BODY);
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    });

    await expect(callTool(tool)).resolves.toEqual(TOOL_RESULT);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.adoptCompleted).toHaveBeenCalledTimes(0);
    expect(fixture.jobs.consumptions).toHaveLength(1);
    expect(fixture.jobs.completions).toHaveLength(1);
    const completed = fixture.broker.read(fixture.vaultPath, pending.id);
    expect(completed).toMatchObject({ state: "consumed" });
    expect(completed.completionMarkerHash).toBeDefined();
    expect(fixture.jobs.completions[0]?.completionMarkerHash).toBe(completed.completionMarkerHash);

    const reopenedBroker = new PermissionBrokerService({
      rootPath: fixture.machineRoot,
      unsafeAllowUnfenced: true
    });
    const restartedRegistry = new PermissionedExternalCapabilityRegistry(
      [fixture.adapter],
      reopenedBroker,
      fixture.jobs
    );
    const restartedTool = requireTool(restartedRegistry.toolsForTurn(fixture.turn));

    await expect(callTool(restartedTool)).resolves.toEqual(TOOL_RESULT);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.adoptCompleted).toHaveBeenCalledTimes(1);
    expect(fixture.adoptCompleted).toHaveBeenCalledWith(
      completed.completionMarkerHash,
      { url: "https://example.invalid/current", body: PRIVATE_BODY },
      expect.any(AbortSignal),
      expect.objectContaining({ toolCallId: "tool_call_external_test" })
    );
    expect(fixture.jobs.consumptions).toHaveLength(1);
    expect(fixture.jobs.completions).toHaveLength(1);
    expect(readMachineJson(fixture.machineRoot)).not.toContain(PRIVATE_BODY);
  });

  it("does not consume or execute an approved action after cancellation wins", async () => {
    const fixture = createFixture();
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    await expect(callTool(tool)).rejects.toMatchObject({ code: "permission.confirmation_required" });
    const pending = requireRecord(fixture.broker.listForJob(fixture.vaultPath, JOB_ID));
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    });
    const controller = new AbortController();
    controller.abort();

    await expect(callTool(tool, controller)).rejects.toMatchObject({ name: "AbortError" });
    expect(fixture.execute).toHaveBeenCalledTimes(0);
    expect(fixture.jobs.consumptions).toHaveLength(0);
    expect(fixture.jobs.completions).toHaveLength(0);
    expect(fixture.broker.read(fixture.vaultPath, pending.id).state).toBe("approved");
  });

  it("never repeats a non-idempotent effect when completion persistence fails after execution", async () => {
    const fixture = createFixture({ destructive: true });
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    await expect(callTool(tool)).rejects.toMatchObject({ code: "permission.confirmation_required" });
    const pending = requireRecord(fixture.broker.listForJob(fixture.vaultPath, JOB_ID));
    fixture.broker.commitDecision(fixture.vaultPath, {
      requestId: pending.id,
      jobId: JOB_ID,
      decision: "allow_once"
    });
    fixture.jobs.failCompletion = true;

    await expect(callTool(tool)).rejects.toThrow("synthetic completion persistence failure");
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    const consumed = fixture.broker.read(fixture.vaultPath, pending.id);
    expect(consumed.state).toBe("consumed");
    expect("completionMarkerHash" in consumed).toBe(false);

    fixture.jobs.failCompletion = false;
    await expect(callTool(tool)).rejects.toMatchObject({ code: "permission.completion_uncertain" });
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(fixture.jobs.completions).toHaveLength(0);
  });
});

type ExternalExecute = PermissionedExternalCapabilityAdapter["execute"];
type ExternalAdopt = NonNullable<PermissionedExternalCapabilityAdapter["adoptCompleted"]>;
type JobPortInput<T extends keyof PermissionedExternalJobPort> =
  Parameters<PermissionedExternalJobPort[T]>[0];

class MemoryJobPort implements PermissionedExternalJobPort {
  readonly bindings: Array<JobPortInput<"bindPermissionRequest">> = [];
  readonly consumptions: Array<JobPortInput<"commitPermissionConsumption">> = [];
  readonly completions: Array<JobPortInput<"completePermissionAction">> = [];
  readonly #completionMarkers = new Map<string, string>();
  failCompletion = false;

  bindPermissionRequest(input: JobPortInput<"bindPermissionRequest">): void {
    this.bindings.push(input);
  }

  commitPermissionConsumption(input: JobPortInput<"commitPermissionConsumption">): void {
    this.consumptions.push(input);
  }

  completePermissionAction(input: JobPortInput<"completePermissionAction">): void {
    if (this.failCompletion) throw new Error("synthetic completion persistence failure");
    this.completions.push(input);
    this.#completionMarkers.set(completionKey(input), input.completionMarkerHash);
  }

  readPermissionCompletion(input: JobPortInput<"readPermissionCompletion">): string | undefined {
    return this.#completionMarkers.get(completionKey(input));
  }
}

function createFixture(options: { readonly destructive?: boolean } = {}): {
  readonly root: string;
  readonly machineRoot: string;
  readonly vaultPath: string;
  readonly broker: PermissionBrokerService;
  readonly jobs: MemoryJobPort;
  readonly adapter: PermissionedExternalCapabilityAdapter;
  readonly execute: ReturnType<typeof vi.fn<ExternalExecute>>;
  readonly adoptCompleted: ReturnType<typeof vi.fn<ExternalAdopt>>;
  readonly registry: PermissionedExternalCapabilityRegistry;
  readonly turn: PermissionedExternalTurnContext;
} {
  const root = tempRoot("pige-permissioned-external-");
  const machineRoot = path.join(root, "machine");
  fs.mkdirSync(machineRoot, { mode: 0o700 });
  const vaultPath = createTestVault(root);
  const broker = new PermissionBrokerService({ rootPath: machineRoot, unsafeAllowUnfenced: true });
  const jobs = new MemoryJobPort();
  const execute = vi.fn<ExternalExecute>(async () => TOOL_RESULT);
  const adoptCompleted = vi.fn<ExternalAdopt>(async () => TOOL_RESULT);
  const adapter = createAdapter(execute, adoptCompleted, options);
  const registry = new PermissionedExternalCapabilityRegistry([adapter], broker, jobs);
  return {
    root,
    machineRoot,
    vaultPath,
    broker,
    jobs,
    adapter,
    execute,
    adoptCompleted,
    registry,
    turn: {
      vaultPath,
      vaultId: VAULT_ID,
      jobId: JOB_ID,
      policyContextId: "policy_context_external_test",
      policyHash: digest("external policy"),
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full",
      assertCurrent: vi.fn()
    }
  };
}

function createAdapter(
  execute: ExternalExecute,
  adoptCompleted: ExternalAdopt,
  options: { readonly destructive?: boolean } = {}
): PermissionedExternalCapabilityAdapter {
  return {
    tool: {
      name: "synthetic_external_fetch",
      label: "Synthetic external fetch",
      description: "Fetches one synthetic external resource.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" }, body: { type: "string" } },
        required: ["url", "body"],
        additionalProperties: false
      },
      outputSchema: {
        type: "object",
        properties: { status: { type: "string" } },
        required: ["status"],
        additionalProperties: true
      },
      effect: options.destructive ? "destructive" : "read_only",
      inputTrust: "model_generated",
      outputTrust: "untrusted_source",
      dataBoundary: {
        resourceScope: "current_vault",
        pathAuthority: "host_only",
        sourceIdAuthority: "host_only",
        modelAuthority: "none"
      },
      execution: "sequential",
      idempotency: options.destructive
        ? { mode: "non_idempotent", scope: "none" }
        : { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 2_048, maxOutputBytes: 4_096, timeoutMs: 5_000 },
      ownerService: "SyntheticExternalCapabilityService"
    },
    actor: {
      type: "skill",
      id: "skill.synthetic.external",
      displayName: "Synthetic External Skill",
      version: "1.0.0",
      digest: digest("synthetic external skill")
    },
    action: {
      id: "network.fetch_current_url",
      version: "1",
      labelKey: "permissions.actions.synthetic_external_fetch"
    },
    permission: {
      capability: "external_network",
      dataBoundary: "network",
      resourceScope: "current_action",
      resourceKind: "url",
      reasonCode: "external.network"
    },
    normalizeInput: (args) => {
      const input = args as { readonly url: string; readonly body: string };
      return { url: input.url, body: input.body };
    },
    resourceIdentity: (normalizedInput) => ({
      url: (normalizedInput as { readonly url: string }).url
    }),
    resourceCount: () => 1,
    execute,
    adoptCompleted
  };
}

function callTool(
  tool: PigeAgentToolDefinition,
  controller = new AbortController()
): Promise<PigeAgentToolResult> {
  const context: PigeAgentToolCallContext = {
    toolCallId: "tool_call_external_test",
    signal: controller.signal
  };
  return tool.execute({
    url: "https://example.invalid/current",
    body: PRIVATE_BODY
  }, controller.signal, context);
}

function requireTool(tools: readonly PigeAgentToolDefinition[]): PigeAgentToolDefinition {
  const tool = tools[0];
  if (!tool) throw new Error("Expected one permissioned external tool.");
  return tool;
}

function requireRecord<T>(records: readonly T[]): T {
  const record = records[0];
  if (!record) throw new Error("Expected one permission request record.");
  return record;
}

function completionKey(input: {
  readonly jobId: string;
  readonly requestId: string;
  readonly bindingHash: string;
}): string {
  return `${input.jobId}\0${input.requestId}\0${input.bindingHash}`;
}

function createTestVault(root: string): string {
  const vaultName = "External Capability Vault";
  createVaultOnDisk({
    parentDirectory: path.join(root, "vaults"),
    vaultName,
    appDataPath: path.join(root, "app-data"),
    tempPath: path.join(root, "temp")
  });
  const vaultPath = path.join(root, "vaults", vaultName);
  const manifestPath = path.join(vaultPath, ".pige", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  fs.writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, vault_id: VAULT_ID }, null, 2)}\n`, "utf8");
  return vaultPath;
}

function readMachineJson(machineRoot: string): string {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".json")) files.push(entryPath);
    }
  };
  visit(machineRoot);
  return files.sort().map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function tempRoot(prefix: string): string {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}
