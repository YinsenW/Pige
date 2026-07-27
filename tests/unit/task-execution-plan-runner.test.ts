import { createHash } from "node:crypto";
import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandExecutionService, type CommandProcessLauncher } from "../../apps/desktop/src/main/services/command-execution-service";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import { PermissionedExternalCapabilityRegistry } from "../../apps/desktop/src/main/services/permissioned-external-capability-service";
import {
  TaskExecutionPlanRunner,
  type ResolvedTaskExecutionPlanRun,
  type TaskExecutionPlanRunnerTurn
} from "../../apps/desktop/src/main/services/task-execution-plan-runner";
import {
  createTaskExecutionPlanConfirmation,
  TaskExecutionPlanService,
  type ResolveTaskExecutionPlanInput
} from "../../apps/desktop/src/main/services/task-execution-plan-service";
import { TaskProcessSessionService } from "../../apps/desktop/src/main/services/task-process-session-service";

const roots: string[] = [];
const RECIPE_ID = "official.feishu-cli.install-config-auth-status";

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("TaskExecutionPlanRunner", () => {
  it("lazily confirms once, advances immutable ordinals, and adopts the terminal probe", async () => {
    const fixture = createFixture();
    const tool = fixture.runner.toolForExplicitHomeTurn(fixture.turn);

    expect(fixture.resolve).not.toHaveBeenCalled();
    expect(fixture.readToolCatalogHash).not.toHaveBeenCalled();
    expect(tool.parameters).toEqual({ type: "object", additionalProperties: false, properties: {}, required: [] });
    expect(JSON.stringify(tool.parameters)).not.toMatch(/executable|argv|path|url/iu);
    await expect(call(tool, { executable: "sh" })).rejects.toMatchObject({
      code: "task_execution.runner_input_invalid",
      message: "The reviewed task plan could not continue."
    });
    expect(fixture.resolve).not.toHaveBeenCalled();

    const first = call(tool, {});
    await vi.waitFor(() => expect(fixture.confirmations.pending().status).toBe("pending"));
    expect(fixture.launch).not.toHaveBeenCalled();
    const pending = fixture.confirmations.pending();
    if (pending.status !== "pending") throw new Error("Expected reviewed plan confirmation.");
    await fixture.confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    });
    await expect(first).resolves.toMatchObject({ details: { status: "completed" } });

    for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
      await expect(call(tool, {}, `tool_call_${ordinal}`)).resolves.toMatchObject({
        details: { status: "completed" }
      });
    }
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
    expect(fixture.launch).toHaveBeenCalledTimes(6);
    expect(fixture.launchedArgs).toEqual([
      ["install_cli_package"],
      ["install_cli_native_asset"],
      ["install_official_skill"],
      ["config_init"],
      ["auth_login"],
      ["auth_status"]
    ]);

    const adopted = await call(tool, {}, "tool_call_terminal_adopt");
    expect(adopted).toMatchObject({ details: { status: "completed" } });
    expect(fixture.launch).toHaveBeenCalledTimes(6);
    expect(fixture.resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed on current binding drift, cancellation, and resolver body leakage", async () => {
    const drift = createFixture();
    const driftTool = drift.runner.toolForExplicitHomeTurn(drift.turn);
    drift.readToolCatalogHash.mockReturnValue(digest("changed-catalog"));
    await expect(call(driftTool)).rejects.toEqual(expect.objectContaining({
      code: "task_execution.runner_plan_invalid",
      message: "The reviewed task plan could not continue."
    }));
    expect(drift.resolve).toHaveBeenCalledOnce();
    expect(drift.launch).not.toHaveBeenCalled();

    const cancelled = createFixture();
    const controller = new AbortController();
    controller.abort(new Error("private cancellation reason"));
    await expect(call(cancelled.runner.toolForExplicitHomeTurn(cancelled.turn), {}, "cancelled", controller))
      .rejects.toEqual(expect.objectContaining({
        code: "task_execution.runner_cancelled",
        message: "The reviewed task plan could not continue."
      }));
    expect(cancelled.resolve).not.toHaveBeenCalled();

    const failed = createFixture();
    failed.resolve.mockRejectedValueOnce(new Error("/Users/private/secret and token"));
    await expect(call(failed.runner.toolForExplicitHomeTurn(failed.turn))).rejects.toEqual(expect.objectContaining({
      code: "task_execution.runner_failed",
      message: "The reviewed task plan could not continue."
    }));
    expect(failed.launch).not.toHaveBeenCalled();
  });
});

function createFixture(): {
  runner: TaskExecutionPlanRunner;
  turn: TaskExecutionPlanRunnerTurn;
  confirmations: HighRiskConfirmationService;
  resolve: ReturnType<typeof vi.fn<(input: Parameters<ConstructorParameters<typeof TaskExecutionPlanRunner>[0]["resolve"]>[0]) => Promise<ResolvedTaskExecutionPlanRun>>>;
  launch: ReturnType<typeof vi.fn<CommandProcessLauncher["spawn"]>>;
  launchedArgs: string[][];
  readToolCatalogHash: ReturnType<typeof vi.fn<() => string>>;
} {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-plan-runner-")));
  roots.push(root);
  const confirmations = new HighRiskConfirmationService();
  const plans = new TaskExecutionPlanService({ confirmPlan: createTaskExecutionPlanConfirmation(confirmations) });
  const launchedArgs: string[][] = [];
  const launch = vi.fn<CommandProcessLauncher["spawn"]>((_executable, args) => {
    launchedArgs.push([...args]);
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: undefined as undefined,
      kill: vi.fn(() => true)
    });
    queueMicrotask(() => child.emit("close", 0, null));
    return child as unknown as ChildProcess;
  });
  const sessions = new TaskProcessSessionService({
    launcher: { spawn: launch },
    openBrowserOAuth: vi.fn(),
    terminateProcessTree: vi.fn()
  });
  const command = new CommandExecutionService().normalize({
    executable: process.execPath,
    workingDirectory: root,
    timeoutMs: 60_000
  });
  const input = resolution(root, command.executable);
  const plan = plans.resolvePlan(input);
  const readCurrentPlanBinding = () => plans.binding(plan);
  const resolve = vi.fn(async (): Promise<ResolvedTaskExecutionPlanRun> => ({
    plan,
    readCurrentPlanBinding,
    steps: plan.steps.map((step, index) => ({
      ordinal: step.ordinal,
      toolName: `pige_reviewed_step_${step.ordinal}`,
      toolLabel: `Reviewed step ${step.ordinal}`,
      capability: index < 3 ? "install_local_tool" : "external_network",
      dataBoundary: "network",
      resourceScope: "current_action",
      readOnlyProbe: index === plan.steps.length - 1,
      process: {
        revision: 1,
        command: Object.freeze({ ...command, args: Object.freeze([...step.argv]) }),
        environment: { HOME: root, PATH: path.dirname(process.execPath) },
        ...(step.interactionProtocol === "browser_oauth"
          ? { interaction: { kind: "browser_oauth" as const, allowedOrigins: [...step.networkOrigins] } }
          : {})
      }
    }))
  }));
  const broker = new PermissionBrokerService({
    rootPath: path.join(root, "machine"),
    unsafeAllowUnfenced: true,
    confirmations
  });
  fs.mkdirSync(path.join(root, "machine"));
  const readToolCatalogHash = vi.fn(() => input.toolCatalogHash);
  const fixture = {
    runner: new TaskExecutionPlanRunner({
      plans,
      sessions,
      createCapabilityRegistry: (adapters) => new PermissionedExternalCapabilityRegistry(adapters, broker),
      resolve
    }),
    confirmations,
    resolve,
    launch,
    launchedArgs,
    readToolCatalogHash,
    turn: undefined as unknown as TaskExecutionPlanRunnerTurn
  };
  fixture.turn = {
    vaultPath: root,
    vaultId: input.vaultId,
    jobId: input.jobId,
    clientTurnId: input.clientTurnId,
    policyContextId: "policy_context_task_runner",
    policyHash: input.policyHash,
    runtimeKind: "desktop_local",
    clientCapabilityTier: "desktop_full",
    readToolCatalogHash,
    assertCurrent: vi.fn()
  };
  return fixture;
}

function resolution(root: string, executable: string): ResolveTaskExecutionPlanInput {
  const actions = [
    ["install_cli_package", "none"],
    ["install_cli_native_asset", "none"],
    ["install_official_skill", "none"],
    ["config_init", "browser_oauth"],
    ["auth_login", "browser_oauth"],
    ["auth_status", "none"]
  ] as const;
  return {
    vaultId: "vault_20260727_runner",
    jobId: "job_20260727_runner001",
    clientTurnId: "turn_20260727_runner000001",
    authoredTaskIntent: "explicit_user_task",
    policyHash: digest("policy"),
    toolCatalogHash: digest("catalog"),
    recipeId: RECIPE_ID,
    actorId: "pige.reviewed-task-plan",
    actorVersion: "1.0.0",
    actorDigest: digest("actor"),
    environment: {
      controlledHomeRoot: root,
      configRoot: root,
      sanitizedPathEntries: [path.dirname(executable)],
      descendantExecutableIdentities: [`node:${digest("node")}`],
      canonicalWorkingDirectory: root,
      temporaryDirectoryPolicy: "plan_private_delete_after_adoption",
      localeProfile: "en-US.UTF-8",
      npmRegistry: "https://registry.npmjs.org",
      npmPrefix: root,
      npmCache: root,
      npmConfigProvenance: "pige_generated_exact",
      targetAgentRoots: [root],
      networkOrigins: ["https://registry.npmjs.org", "https://accounts.feishu.cn"],
      destinations: [root],
      secretHandleVersions: {}
    },
    steps: actions.map(([actionId, interactionProtocol], index) => ({
      ordinal: index + 1,
      adapterId: `pige.runner.${actionId}`,
      adapterVersion: "1.0.0",
      adapterDigest: digest(`adapter:${actionId}`),
      actionId,
      normalizedExecutableIdentity: executable,
      argv: [actionId],
      canonicalWorkingDirectory: root,
      environmentProfileHash: digest("environment"),
      networkOrigins: interactionProtocol === "browser_oauth"
        ? ["https://accounts.feishu.cn"]
        : ["https://registry.npmjs.org"],
      destinations: index === 5 ? [] : [root],
      interactionProtocol,
      timeoutMs: 60_000,
      inputHash: digest(`input:${actionId}`),
      postconditionProbeId: `probe.${actionId}`,
      recoveryMode: "probe_then_adopt"
    })),
    resolvedVersion: "1.0.77",
    integrities: [digest("cli"), digest("skills")],
    destinationRoots: ["Pige managed tools"],
    skillCount: 27,
    targetAgents: ["codex"]
  };
}

function call(
  tool: ReturnType<TaskExecutionPlanRunner["toolForExplicitHomeTurn"]>,
  args: unknown = {},
  toolCallId = "tool_call_runner",
  controller = new AbortController()
) {
  return tool.execute(args, controller.signal, { toolCallId, signal: controller.signal });
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
