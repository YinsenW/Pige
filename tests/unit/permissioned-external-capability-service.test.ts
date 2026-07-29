import { createHash } from "node:crypto";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionPolicyStore } from "../../apps/desktop/src/main/services/permission-policy-store";
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
import {
  CommandExecutionService,
  type CommandProcessLauncher
} from "../../apps/desktop/src/main/services/command-execution-service";
import { createTaskExecutionPlanCapabilityAdapter } from "../../apps/desktop/src/main/services/task-execution-plan-capability-adapter";
import { TaskProcessSessionService } from "../../apps/desktop/src/main/services/task-process-session-service";

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

  it("does not settle allow or deny before durable decision links succeed", async () => {
    for (const decision of ["allow", "deny"] as const) {
      const appDataRoot = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `pige-permission-order-${decision}-`)));
      fs.chmodSync(appDataRoot, 0o700);
      roots.push(appDataRoot);
      let failLink = true;
      const order: string[] = [];
      const confirmations = new HighRiskConfirmationService(
        new PermissionPolicyStore(appDataRoot, vi.fn()),
        {
          recordPending: vi.fn(),
          recordDecision: vi.fn(() => {
            if (failLink) throw new Error("synthetic link failure");
            order.push("decision_link");
          })
        }
      );
      const adapter = highRiskShellAdapter(async () => {
        order.push("effect");
        return RESULT;
      });
      const fixture = createFixture(adapter, confirmations);
      const tool = requireTool(fixture.registry.toolsForTurn({ ...fixture.turn, confirmationOwner: OWNER }));
      let settled = false;
      const execution = call(tool, `tool_call_${decision}`);
      void execution.then(
        () => { settled = true; },
        () => { settled = true; }
      );
      await vi.waitFor(() => expect(confirmations.pending().status).toBe("pending"));
      const pending = confirmations.pending();
      if (pending.status !== "pending") throw new Error("Expected pending confirmation.");
      const request = {
        apiVersion: 1 as const,
        confirmationId: pending.confirmation.confirmationId,
        expectedRevision: pending.revision,
        decision
      };

      await expect(confirmations.resolve(request)).resolves.toMatchObject({ status: "failed" });
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(order).toEqual([]);

      failLink = false;
      await expect(confirmations.resolve(request)).resolves.toMatchObject({ status: "already_resolved", decision });
      expect(order[0]).toBe("decision_link");
      if (decision === "allow") {
        await expect(execution).resolves.toEqual(RESULT);
        expect(order).toEqual(["decision_link", "effect"]);
      } else {
        await expect(execution).rejects.toMatchObject({ code: "permission.denied" });
        expect(order).toEqual(["decision_link"]);
      }
    }
  });

  it("commits and clears confirmation before a long owning effect completes", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const fixture = createFixture(highRiskShellAdapter(async () => {
      await gate;
      return RESULT;
    }));
    const tool = requireTool(fixture.registry.toolsForTurn({ ...fixture.turn, confirmationOwner: OWNER }));
    const execution = call(tool);
    await vi.waitFor(() => expect(fixture.confirmations.pending().status).toBe("pending"));
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected pending confirmation.");

    await expect(fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    })).resolves.toMatchObject({ status: "committed", decision: "allow" });
    expect(fixture.confirmations.pending()).toEqual({ apiVersion: 1, status: "none", revision: 2 });
    expect(fixture.execute).toHaveBeenCalledOnce();

    release();
    await expect(execution).resolves.toEqual(RESULT);
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

  it("executes an exact reviewed plan ordinal without a second confirmation", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-reviewed-plan-")));
    roots.push(root);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined as undefined,
      kill: vi.fn(() => true)
    });
    const launch = vi.fn<CommandProcessLauncher["spawn"]>(() => child as unknown as ChildProcess);
    const sessions = new TaskProcessSessionService({
      launcher: { spawn: launch },
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: vi.fn()
    });
    const command = new CommandExecutionService().normalize({
      executable: process.execPath,
      args: ["--version"],
      workingDirectory: root
    });
    const assertAuthority = vi.fn();
    const adapter = createTaskExecutionPlanCapabilityAdapter({
      metadata: {
        planId: "plan_0123456789abcdef0123456789abcdef",
        jobId: JOB_ID,
        stepOrdinal: 1,
        planDigest: digest("reviewed plan"),
        adapterId: "pige.task-execution-plan",
        adapterVersion: "1.0.0",
        adapterDigest: digest("task adapter"),
        actionId: "task_plan.install_cli",
        toolName: "pige_run_reviewed_plan_step",
        toolLabel: "Install Feishu CLI",
        capability: "install_local_tool",
        dataBoundary: "network",
        resourceScope: "current_action",
        readOnlyProbe: false
      },
      process: {
        planId: "plan_0123456789abcdef0123456789abcdef",
        jobId: JOB_ID,
        stepOrdinal: 1,
        revision: 3,
        command,
        environment: { HOME: root, PATH: path.dirname(process.execPath) },
        assertCurrent: vi.fn()
      },
      sessions,
      assertAuthority
    });
    const fixture = createFixture(adapter);
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));

    const execution = call(tool, "tool_call_reviewed_step");
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce());
    child.emit("close", 0, null);
    await expect(execution).resolves.toMatchObject({ details: { status: "completed" } });
    expect(fixture.confirmations.pending()).toEqual({ apiVersion: 1, status: "none", revision: 0 });
    expect(assertAuthority).toHaveBeenCalledWith(expect.objectContaining({
      planId: "plan_0123456789abcdef0123456789abcdef",
      jobId: JOB_ID,
      stepOrdinal: 1,
      planDigest: digest("reviewed plan"),
      disposition: "execute"
    }));

    await expect(call(tool, "tool_call_reviewed_step")).resolves.toMatchObject({
      details: { status: "completed" }
    });
    expect(launch).toHaveBeenCalledOnce();
    expect(assertAuthority).toHaveBeenLastCalledWith(expect.objectContaining({ disposition: "adopt" }));
  });

  it("uses reviewed metadata for read-only probes and rejects stale plan authority before spawn", async () => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-reviewed-probe-")));
    roots.push(root);
    const launch = vi.fn<CommandProcessLauncher["spawn"]>();
    const sessions = new TaskProcessSessionService({
      launcher: { spawn: launch },
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: vi.fn()
    });
    const command = new CommandExecutionService().normalize({
      executable: process.execPath,
      args: ["-e", "process.stdout.write('arbitrary-looking text is not authority')"],
      workingDirectory: root
    });
    const adapter = createTaskExecutionPlanCapabilityAdapter({
      metadata: {
        planId: "plan_fedcba9876543210fedcba9876543210",
        jobId: JOB_ID,
        stepOrdinal: 6,
        planDigest: digest("reviewed probe"),
        adapterId: "pige.task-execution-plan",
        adapterVersion: "1.0.0",
        adapterDigest: digest("task adapter"),
        actionId: "task_plan.auth_status",
        toolName: "pige_probe_reviewed_plan_step",
        toolLabel: "Check Feishu status",
        capability: "external_network",
        dataBoundary: "network",
        resourceScope: "current_action",
        readOnlyProbe: true
      },
      process: {
        planId: "plan_fedcba9876543210fedcba9876543210",
        jobId: JOB_ID,
        stepOrdinal: 6,
        revision: 2,
        command,
        environment: { HOME: root },
        assertCurrent: vi.fn()
      },
      sessions,
      assertAuthority: () => { throw Object.assign(new Error("stale plan"), { code: "task_plan.stale" }); }
    });
    const fixture = createFixture(adapter);
    const tool = requireTool(fixture.registry.toolsForTurn(fixture.turn));
    expect(tool).toMatchObject({
      effect: "read_only",
      execution: "parallel_read_only",
      idempotency: { mode: "idempotent", scope: "tool_call" }
    });

    await expect(call(tool, "tool_call_stale_probe")).rejects.toMatchObject({
      code: "permission.reviewed_plan_invalid"
    });
    expect(launch).not.toHaveBeenCalled();
    expect(fixture.confirmations.pending()).toEqual({ apiVersion: 1, status: "none", revision: 0 });
  });
});

type Execute = PermissionedExternalCapabilityAdapter["execute"];

function createFixture(
  adapter: PermissionedExternalCapabilityAdapter,
  confirmations = new HighRiskConfirmationService()
): {
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
