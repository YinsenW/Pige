import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import {
  assertPermissionedExternalExecutionAuthority,
  PermissionedExternalCapabilityRegistry,
  type PermissionedExternalCapabilityAdapter,
  type PermissionedExternalExecutionAuthority,
  type PermissionedExternalTurnContext
} from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import type {
  PigeAgentToolCallContext,
  PigeAgentToolDefinition,
  PigeAgentToolResult
} from "../../apps/desktop/src/main/services/pi-agent-runtime-adapter";

const roots: string[] = [];
const VAULT_ID = "vault_20260722_external01";
const JOB_ID = "job_20260722_external01";
const OWNER = { kind: "agent_turn" as const, clientTurnId: "turn_20260722_externalabcdef" };
const RESULT: PigeAgentToolResult = {
  content: [{ type: "text", text: "bounded result" }],
  details: { status: "ok" }
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PermissionedExternalCapabilityRegistry AR1 authority", () => {
  it("keeps the production-default registry empty without authority dependencies", () => {
    const registry = new PermissionedExternalCapabilityRegistry();
    expect(registry.toolNames()).toEqual([]);
    expect(registry.toolsForTurn(turn("/not/read"))).toEqual([]);
  });

  it("executes an ordinary registered first-party capability under the submitted turn with zero permission records", async () => {
    const fixture = createFixture(firstPartyAdapter());
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    await expect(call(tool)).resolves.toEqual(RESULT);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(findJsonFiles(fixture.machineRoot)).toEqual([]);
  });

  it("registers a closed high-risk effect without creating a Job waiting state and denial has no effect", async () => {
    const fixture = createFixture(highRiskShellAdapter());
    const tool = requireTool(fixture.registry.toolsForTurn({ ...fixture.turn, confirmationOwner: OWNER }));

    const execution = call(tool);
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    expect(fixture.execute).toHaveBeenCalledTimes(0);
    const pending = fixture.confirmations.pending();
    expect(pending).toMatchObject({
      status: "pending",
      confirmation: {
        effect: "arbitrary_shell",
        presentation: { subject: { kind: "executable_name", value: "lark-cli" } },
        owner: OWNER
      }
    });
    if (pending.status !== "pending") throw new Error("Expected pending confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "deny"
    });
    await expect(execution).rejects.toMatchObject({ code: "permission.denied" });
    await expect(call(tool)).rejects.toMatchObject({ code: "permission.denied" });
    expect(fixture.execute).toHaveBeenCalledTimes(0);
  });

  it("executes exactly once after canonical allow and revokes the unforgeable authority", async () => {
    let captured: PermissionedExternalExecutionAuthority | undefined;
    const adapter = highRiskShellAdapter(async (_input, _signal, _context, authority) => {
      captured = authority;
      assertPermissionedExternalExecutionAuthority(authority, "run_shell");
      return RESULT;
    });
    const fixture = createFixture(adapter);
    const tool = requireTool(fixture.registry.toolsForTurn({ ...fixture.turn, confirmationOwner: OWNER }));

    const execution = call(tool);
    await vi.waitFor(() => expect(fixture.confirmations.pending()).toMatchObject({ status: "pending" }));
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected pending confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });
    await expect(execution).resolves.toEqual(RESULT);
    await expect(call(tool)).resolves.toEqual(RESULT);
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    expect(() => assertPermissionedExternalExecutionAuthority(captured, "run_shell"))
      .toThrowError(expect.objectContaining({ code: "permission.execution_authority_invalid" }));
  });

  it("single-flights the same exact tool call but does not collapse distinct tool-call identities", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fixture = createFixture(firstPartyAdapter(async () => {
      await gate;
      return RESULT;
    }));
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    const first = call(tool, "tool_call_same");
    const joined = call(tool, "tool_call_same");
    await vi.waitFor(() => expect(fixture.execute).toHaveBeenCalledTimes(1));
    release();
    await expect(Promise.all([first, joined])).resolves.toEqual([RESULT, RESULT]);

    await expect(call(tool, "tool_call_distinct")).resolves.toEqual(RESULT);
    expect(fixture.execute).toHaveBeenCalledTimes(2);
  });

  it("revalidates cancellation and turn scope immediately before execution", async () => {
    const fixture = createFixture(firstPartyAdapter());
    let current = true;
    const tool = requireTool(fixture.registry.toolsForTurn({
      ...fixture.turn,
      assertCurrent: () => {
        if (!current) throw Object.assign(new Error("stale"), { code: "permission.binding_changed" });
        current = false;
      }
    }));

    await expect(call(tool)).rejects.toMatchObject({ code: "permission.binding_changed" });
    expect(fixture.execute).toHaveBeenCalledTimes(0);

    const controller = new AbortController();
    controller.abort();
    const fresh = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    await expect(call(fresh, "tool_call_aborted", controller)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("fails closed for an unclassified third-party capability", async () => {
    const fixture = createFixture(thirdPartyOrdinaryAdapter());
    const tool = requireTool(fixture.registry.toolsForTurn({ ...fixture.turn, confirmationOwner: OWNER }));
    await expect(call(tool)).rejects.toMatchObject({ code: "permission.high_risk_classification_required" });
    expect(fixture.execute).toHaveBeenCalledTimes(0);
    expect(fixture.confirmations.pending()).toMatchObject({ status: "none" });
  });
});

type Execute = PermissionedExternalCapabilityAdapter["execute"];

function createFixture(adapter: PermissionedExternalCapabilityAdapter): {
  machineRoot: string;
  vaultPath: string;
  confirmations: HighRiskConfirmationService;
  broker: PermissionBrokerService;
  execute: ReturnType<typeof vi.fn<Execute>>;
  registry: PermissionedExternalCapabilityRegistry;
  turn: PermissionedExternalTurnContext;
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-ar1-external-")));
  roots.push(root);
  const machineRoot = path.join(root, "machine");
  const vaultPath = path.join(root, "vault");
  fs.mkdirSync(machineRoot);
  fs.mkdirSync(vaultPath);
  const confirmations = new HighRiskConfirmationService();
  const broker = new PermissionBrokerService({ rootPath: machineRoot, unsafeAllowUnfenced: true, confirmations });
  const execute = adapter.execute as ReturnType<typeof vi.fn<Execute>>;
  return {
    machineRoot,
    vaultPath,
    confirmations,
    broker,
    execute,
    registry: new PermissionedExternalCapabilityRegistry([adapter], broker),
    turn: turn(vaultPath)
  };
}

function firstPartyAdapter(execute: Execute = vi.fn(async () => RESULT)): PermissionedExternalCapabilityAdapter {
  return adapter({ actorType: "local_tool", actorId: "pige.command-execution", execute });
}

function highRiskShellAdapter(execute: Execute = vi.fn(async () => RESULT)): PermissionedExternalCapabilityAdapter {
  return adapter({
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

function thirdPartyOrdinaryAdapter(execute: Execute = vi.fn(async () => RESULT)): PermissionedExternalCapabilityAdapter {
  return adapter({ actorType: "skill", actorId: "skill.external.network", execute, capability: "external_network" });
}

function adapter(input: {
  actorType: "skill" | "package" | "local_tool";
  actorId: string;
  execute: Execute;
  capability?: "run_shell" | "external_network";
  highRisk?: PermissionedExternalCapabilityAdapter["permission"]["highRisk"];
}): PermissionedExternalCapabilityAdapter {
  const execute = vi.isMockFunction(input.execute) ? input.execute : vi.fn(input.execute);
  return {
    tool: {
      name: `synthetic_${input.actorType}_tool`,
      label: "Synthetic tool",
      description: "Synthetic bounded tool.",
      parameters: { type: "object", additionalProperties: false },
      outputSchema: { type: "object" },
      effect: "idempotent_write",
      inputTrust: "model_generated",
      outputTrust: "host_validated",
      dataBoundary: { resourceScope: "current_vault", pathAuthority: "host_only", sourceIdAuthority: "host_only", modelAuthority: "none" },
      execution: "sequential",
      idempotency: { mode: "idempotent", scope: "tool_call" },
      limits: { maxInputBytes: 1024, maxOutputBytes: 4096, timeoutMs: 5000 },
      ownerService: "SyntheticService"
    },
    actor: { type: input.actorType, id: input.actorId, displayName: "Synthetic actor", version: "1.0.0", digest: digest(input.actorId) },
    action: { id: "synthetic.execute", version: "1", labelKey: "permissions.actions.synthetic" },
    permission: {
      capability: input.capability ?? "run_shell",
      dataBoundary: "local",
      resourceScope: "current_action",
      resourceKind: "shell",
      reasonCode: "synthetic.execute",
      ...(input.highRisk ? { highRisk: () => input.highRisk! } : {})
    },
    normalizeInput: (value) => value,
    resourceIdentity: (value) => value,
    resourceDisplayName: () => "lark-cli",
    resourceCount: () => 1,
    execute
  };
}

function turn(vaultPath: string): PermissionedExternalTurnContext {
  return {
    vaultPath,
    vaultId: VAULT_ID,
    jobId: JOB_ID,
    policyContextId: "policy_context_external",
    policyHash: digest("policy"),
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    assertCurrent: vi.fn()
  };
}

function call(tool: PigeAgentToolDefinition, toolCallId = "tool_call_external", controller = new AbortController()): Promise<PigeAgentToolResult> {
  const context: PigeAgentToolCallContext = { toolCallId, signal: controller.signal };
  return tool.execute({}, controller.signal, context);
}

function requireTool(tools: readonly PigeAgentToolDefinition[]): PigeAgentToolDefinition {
  const tool = tools[0];
  if (!tool) throw new Error("Expected one tool.");
  return tool;
}

function findJsonFiles(root: string): string[] {
  return fs.readdirSync(root, { recursive: true }).map(String).filter((entry) => entry.endsWith(".json"));
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
