import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createTaskExecutionPlanConfirmation,
  createNodeTaskExecutionPlanProgressStore,
  TaskExecutionPlanService,
  type ResolveTaskExecutionPlanInput,
  type TaskExecutionPlanBinding
} from "../../apps/desktop/src/main/services/task-execution-plan-service";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";

const RECIPE_ID = "official.feishu-cli.install-config-auth-status";

describe("TaskExecutionPlanService", () => {
  it("resolves the registered Feishu recipe, confirms once, and consumes exact ordinals once", async () => {
    const confirmPlan = vi.fn(async () => "allow" as const);
    const service = new TaskExecutionPlanService({ confirmPlan });
    const plan = service.resolvePlan(feishuResolution());
    const reread = current(service, plan);

    expect(service.registeredRecipeIdentity(RECIPE_ID)).toEqual({
      recipeId: RECIPE_ID,
      recipeVersion: "1",
      recipeDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
    expect(service.summary(plan)).toEqual({
      planId: expect.stringMatching(/^plan_[a-f0-9]{32}$/u),
      toolLabel: "Feishu CLI",
      resolvedVersion: "1.0.77",
      sourceOrigin: "https://registry.npmjs.org",
      integrities: [digest("cli-tarball"), digest("native-binary"), digest("skills-tarball")],
      stepCount: 6,
      destinationRoots: ["Pige managed tools", "Reviewed Agent skill roots", "Private Feishu config"],
      skillCount: 27,
      targetAgents: ["codex", "claude-code"],
      requiresBrowserOAuth: true
    });
    expect(JSON.stringify(service.summary(plan))).not.toContain("/private/");
    expect(JSON.stringify(service.summary(plan))).not.toContain("device-code");

    await Promise.all([service.confirmPlan(plan, reread), service.confirmPlan(plan, reread)]);
    expect(confirmPlan).toHaveBeenCalledTimes(1);
    expect(confirmPlan).toHaveBeenCalledWith(service.summary(plan), service.binding(plan), undefined);

    const first = service.issueNextAuthority(plan, 1, reread);
    expect(service.issueNextAuthority(plan, 1, reread)).toBe(first);
    expect(JSON.stringify(first)).toBe("{}");
    expect(service.consumeAuthority(first, plan, 1, reread)).toMatchObject({
      ordinal: 1,
      actionId: "install_cli_package",
      normalizedExecutableIdentity: "/private/pige/tools/npm"
    });
    expect(() => service.consumeAuthority(first, plan, 1, reread))
      .toThrowError(expect.objectContaining({ code: "task_execution.authority_invalid" }));
  });

  it("is deterministic for an identical resolution and rejects neutral or malformed registered authority", () => {
    const service = new TaskExecutionPlanService({ confirmPlan: async () => "allow" });
    const first = service.resolvePlan(feishuResolution());
    const second = service.resolvePlan(feishuResolution());
    expect(second).toBe(first);
    const changedResolution = feishuResolution();
    const changed = service.resolvePlan({ ...changedResolution, integrities: [digest("different-resolution")] });
    expect(changed.planId).not.toBe(first.planId);
    expect(changed.planDigest).not.toBe(first.planDigest);

    expect(() => service.resolvePlan({ ...feishuResolution(), authoredTaskIntent: "neutral_attachment" }))
      .toThrowError(expect.objectContaining({ code: "task_execution.plan_invalid" }));
    expect(() => service.resolvePlan({ ...feishuResolution(), destinationRoots: ["/private/raw-path"] }))
      .toThrowError(expect.objectContaining({ code: "task_execution.plan_invalid" }));
    expect(() => new TaskExecutionPlanService({
      confirmPlan: async () => "allow",
      manifest: { schemaVersion: 1, owner: "TaskExecutionPlanService", limits: {}, officialRecipeFixture: {} }
    })).toThrowError(expect.objectContaining({ code: "task_execution.plan_invalid" }));
  });

  it("fails closed when confirmation-time policy or environment bindings drift", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const confirmPlan = vi.fn(async () => {
      await gate;
      return "allow" as const;
    });
    const service = new TaskExecutionPlanService({ confirmPlan });
    const plan = service.resolvePlan(feishuResolution());
    let binding = service.binding(plan);
    const pending = service.confirmPlan(plan, () => binding);
    await vi.waitFor(() => expect(confirmPlan).toHaveBeenCalledTimes(1));
    binding = { ...binding, policyHash: digest("changed-policy") };
    release();

    await expect(pending).rejects.toMatchObject({ code: "task_execution.binding_changed" });
    expect(() => service.issueNextAuthority(plan, 1, () => binding))
      .toThrowError(expect.objectContaining({ code: "task_execution.binding_changed" }));
  });

  it("rejects plan drift, reordering, cross-service authority, and denial before any step is returned", async () => {
    const denied = new TaskExecutionPlanService({ confirmPlan: async () => "deny" });
    const deniedPlan = denied.resolvePlan(feishuResolution());
    await expect(denied.confirmPlan(deniedPlan, current(denied, deniedPlan)))
      .rejects.toMatchObject({ code: "task_execution.confirmation_denied" });
    expect(() => denied.issueNextAuthority(deniedPlan, 1, current(denied, deniedPlan)))
      .toThrowError(expect.objectContaining({ code: "task_execution.authority_invalid" }));

    const service = new TaskExecutionPlanService({ confirmPlan: async () => "allow" });
    const plan = service.resolvePlan(feishuResolution());
    const reread = current(service, plan);
    await service.confirmPlan(plan, reread);
    expect(() => service.issueNextAuthority(plan, 2, reread))
      .toThrowError(expect.objectContaining({ code: "task_execution.authority_invalid" }));

    const other = new TaskExecutionPlanService({ confirmPlan: async () => "allow" });
    const otherPlan = other.resolvePlan(feishuResolution());
    await other.confirmPlan(otherPlan, current(other, otherPlan));
    const otherAuthority = other.issueNextAuthority(otherPlan, 1, current(other, otherPlan));
    expect(() => other.consumeAuthority(otherAuthority, otherPlan, 1, current(service, plan)))
      .toThrowError(expect.objectContaining({ code: "task_execution.binding_changed" }));
  });

  it("routes one safe reviewed-plan summary through the canonical confirmation owner", async () => {
    const confirmations = new HighRiskConfirmationService();
    const service = new TaskExecutionPlanService({
      confirmPlan: createTaskExecutionPlanConfirmation(confirmations)
    });
    const plan = service.resolvePlan(feishuResolution());
    const pendingConfirmation = service.confirmPlan(plan, current(service, plan));

    await vi.waitFor(() => expect(confirmations.pending().status).toBe("pending"));
    const pending = confirmations.pending();
    expect(pending).toMatchObject({
      status: "pending",
      confirmation: {
        effect: "reviewed_execution_plan",
        presentation: {
          action: "execute_reviewed_plan",
          target: "local_toolchain",
          subject: {
            kind: "reviewed_execution_plan",
            value: "Feishu CLI",
            plan: service.summary(plan)
          }
        }
      }
    });
    expect(JSON.stringify(pending)).not.toContain("/private/");
    if (pending.status !== "pending") throw new Error("expected a pending reviewed plan");
    await expect(confirmations.resolve({
      apiVersion: 1,
      confirmationId: pending.confirmation.confirmationId,
      expectedRevision: pending.revision,
      decision: "allow"
    })).resolves.toMatchObject({ status: "committed", decision: "allow" });
    await expect(pendingConfirmation).resolves.toBeUndefined();
    expect(service.issueNextAuthority(plan, 1, current(service, plan))).toBeDefined();
  });

  it("withdraws an aborted reviewed-plan confirmation without granting authority", async () => {
    const confirmations = new HighRiskConfirmationService();
    const service = new TaskExecutionPlanService({
      confirmPlan: createTaskExecutionPlanConfirmation(confirmations)
    });
    const plan = service.resolvePlan(feishuResolution());
    const controller = new AbortController();
    const pendingConfirmation = service.confirmPlan(plan, current(service, plan), controller.signal);
    await vi.waitFor(() => expect(confirmations.pending().status).toBe("pending"));
    controller.abort();

    await expect(pendingConfirmation).rejects.toMatchObject({ name: "AbortError" });
    expect(confirmations.pending().status).toBe("none");
    expect(() => service.issueNextAuthority(plan, 1, current(service, plan)))
      .toThrowError(expect.objectContaining({ code: "task_execution.binding_changed" }));
  });

  it("durably retains one confirmation and fails closed on an interrupted exact ordinal until adoption", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-task-plan-progress-"));
    try {
      const progressStore = createNodeTaskExecutionPlanProgressStore(root);
      const firstConfirmation = vi.fn(async () => "allow" as const);
      const first = new TaskExecutionPlanService({ confirmPlan: firstConfirmation, progressStore });
      const firstPlan = first.resolvePlan(feishuResolution());
      await first.confirmPlan(firstPlan, current(first, firstPlan));
      const authority = first.issueNextAuthority(firstPlan, 1, current(first, firstPlan));
      first.consumeAuthority(authority, firstPlan, 1, current(first, firstPlan));
      expect(first.stepDisposition(firstPlan, 1)).toBe("started");

      const restartedConfirmation = vi.fn(async () => "allow" as const);
      const restarted = new TaskExecutionPlanService({ confirmPlan: restartedConfirmation, progressStore });
      const restartedPlan = restarted.resolvePlan(feishuResolution());
      await restarted.confirmPlan(restartedPlan, current(restarted, restartedPlan));
      expect(restartedConfirmation).not.toHaveBeenCalled();
      expect(restarted.stepDisposition(restartedPlan, 1)).toBe("started");
      expect(() => restarted.issueNextAuthority(restartedPlan, 1, current(restarted, restartedPlan)))
        .toThrowError(expect.objectContaining({ code: "task_execution.authority_invalid" }));

      restarted.completeStep(restartedPlan, 1, current(restarted, restartedPlan));
      const adopted = new TaskExecutionPlanService({ confirmPlan: restartedConfirmation, progressStore });
      const adoptedPlan = adopted.resolvePlan(feishuResolution());
      expect(adopted.stepDisposition(adoptedPlan, 1)).toBe("completed");
      expect(adopted.stepDisposition(adoptedPlan, 2)).toBe("pending");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

function current(
  service: TaskExecutionPlanService,
  plan: Parameters<TaskExecutionPlanService["binding"]>[0]
): () => TaskExecutionPlanBinding {
  const binding = service.binding(plan);
  return () => binding;
}

function feishuResolution(): ResolveTaskExecutionPlanInput {
  const actions = [
    ["install_cli_package", "none"],
    ["install_cli_native_asset", "none"],
    ["install_official_skill", "none"],
    ["config_init", "browser_oauth"],
    ["auth_login", "browser_oauth"],
    ["auth_status", "none"]
  ] as const;
  const workingDirectory = "/private/pige/task-plan/work";
  const environmentProfileHash = digest("canonical-environment");
  return {
    vaultId: "vault_20260727_taskplan",
    jobId: "job_20260727_taskplan",
    clientTurnId: "turn_20260727_taskplanabcd",
    authoredTaskIntent: "explicit_user_task",
    policyHash: digest("policy"),
    toolCatalogHash: digest("catalog"),
    recipeId: RECIPE_ID,
    actorId: "pige.reviewed-task-plan",
    actorVersion: "1.0.0",
    actorDigest: digest("actor"),
    environment: {
      controlledHomeRoot: "/private/pige/task-plan/home",
      configRoot: "/private/pige/task-plan/config",
      sanitizedPathEntries: ["/private/pige/tools/bin", "/usr/bin"],
      descendantExecutableIdentities: [
        `npm@11.9.0:${digest("npm")}`,
        `lark-cli@1.0.77:${digest("lark-cli")}`
      ],
      canonicalWorkingDirectory: workingDirectory,
      temporaryDirectoryPolicy: "plan_private_delete_after_adoption",
      localeProfile: "en-US.UTF-8",
      npmRegistry: "https://registry.npmjs.org",
      npmPrefix: "/private/pige/tools/npm-prefix",
      npmCache: "/private/pige/task-plan/npm-cache",
      npmConfigProvenance: "pige_generated_exact",
      targetAgentRoots: ["/private/pige/agents/codex", "/private/pige/agents/claude-code"],
      networkOrigins: [
        "https://registry.npmjs.org",
        "https://github.com",
        "https://open.feishu.cn",
        "https://accounts.feishu.cn",
        "https://accounts.larksuite.com"
      ],
      destinations: [
        "/private/pige/tools",
        "/private/pige/agents/codex/skills",
        "/private/pige/agents/claude-code/skills",
        "/private/pige/task-plan/config"
      ],
      secretHandleVersions: { "feishu.oauth": "1" }
    },
    steps: actions.map(([actionId, interactionProtocol], index) => ({
      ordinal: index + 1,
      adapterId: `pige.feishu.${actionId}`,
      adapterVersion: "1.0.0",
      adapterDigest: digest(`adapter:${actionId}`),
      actionId,
      normalizedExecutableIdentity: index < 3
        ? "/private/pige/tools/npm"
        : "/private/pige/tools/lark-cli",
      argv: [actionId, `--synthetic-step=${index + 1}`],
      canonicalWorkingDirectory: workingDirectory,
      environmentProfileHash,
      networkOrigins: interactionProtocol === "browser_oauth"
        ? ["https://accounts.feishu.cn", "https://accounts.larksuite.com"]
        : ["https://registry.npmjs.org"],
      destinations: index === 5 ? [] : [`/private/pige/task-plan/destination-${index + 1}`],
      interactionProtocol,
      timeoutMs: 60_000,
      inputHash: digest(`input:${actionId}`),
      postconditionProbeId: `probe.${actionId}`,
      recoveryMode: "probe_then_adopt"
    })),
    resolvedVersion: "1.0.77",
    integrities: [digest("cli-tarball"), digest("native-binary"), digest("skills-tarball")],
    destinationRoots: ["Pige managed tools", "Reviewed Agent skill roots", "Private Feishu config"],
    skillCount: 27,
    targetAgents: ["codex", "claude-code"]
  };
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
