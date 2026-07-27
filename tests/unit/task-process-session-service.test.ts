import { type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CommandExecutionService,
  type CommandProcessLauncher,
  type CommandProcessLaunchOptions
} from "../../apps/desktop/src/main/services/command-execution-service";
import {
  TaskProcessSessionService,
  type TaskProcessSessionRequest
} from "../../apps/desktop/src/main/services/task-process-session-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("TaskProcessSessionService", () => {
  it("runs shell:false, bounds and redacts streams, and keeps OAuth secrets Main-private", async () => {
    const fixture = createFixture();
    const opened = vi.fn();
    const stream = vi.fn();
    const service = new TaskProcessSessionService({
      launcher: fixture.launcher,
      openBrowserOAuth: opened,
      terminateProcessTree: fixture.terminate
    });
    const interactionEvents: unknown[] = [];
    service.onInteractionChanged((event) => interactionEvents.push(event));
    const request = makeRequest(fixture, {
      redactions: ["private-token"],
      interaction: { kind: "browser_oauth", allowedOrigins: ["https://accounts.feishu.cn"] },
      onStream: stream
    });

    const completion = service.run(request, new AbortController().signal);
    fixture.child.stdout.write("token=private-");
    fixture.child.stdout.write("token\n");
    fixture.child.stdout.write(JSON.stringify({
      type: "browser_oauth",
      url: "https://accounts.feishu.cn/device?user_code=ABCD",
      deviceCode: "private-device-code"
    }) + "\n");
    fixture.child.emit("close", 0, null);

    await expect(completion).resolves.toMatchObject({
      status: "interaction_pending",
      stdout: "token=[redacted]\n[browser_oauth interaction ready]\n",
      exitCode: 0,
      truncated: false
    });
    expect(fixture.launches).toHaveLength(1);
    expect(fixture.launches[0]).toMatchObject({
      executable: fs.realpathSync.native(process.execPath),
      args: ["--version"],
      options: { shell: false, stdio: ["ignore", "pipe", "pipe"] }
    });
    expect(JSON.stringify(stream.mock.calls)).not.toContain("private-token");
    expect(JSON.stringify(stream.mock.calls)).not.toContain("private-device-code");

    const interaction = service.interaction();
    expect(interaction).toMatchObject({
      status: "browser_oauth",
      planId: request.planId,
      jobId: request.jobId,
      stepOrdinal: 4,
      origin: "https://accounts.feishu.cn",
      revision: 7
    });
    expect(JSON.stringify(interaction)).not.toContain("device?");
    expect(JSON.stringify(interaction)).not.toContain("private-device-code");
    expect(interactionEvents).toEqual([interaction]);
    if (interaction.status !== "browser_oauth") throw new Error("Expected OAuth interaction.");

    await expect(service.openInteraction({
      interactionId: interaction.interactionId,
      planId: interaction.planId,
      jobId: interaction.jobId,
      stepOrdinal: interaction.stepOrdinal,
      expectedRevision: interaction.revision + 1
    })).resolves.toEqual({ status: "stale", revision: 7 });
    expect(opened).not.toHaveBeenCalled();

    await expect(service.openInteraction({
      interactionId: interaction.interactionId,
      planId: interaction.planId,
      jobId: interaction.jobId,
      stepOrdinal: interaction.stepOrdinal,
      expectedRevision: interaction.revision
    })).resolves.toEqual({ status: "opened", revision: 8 });
    expect(opened).toHaveBeenCalledWith({
      url: "https://accounts.feishu.cn/device?user_code=ABCD",
      deviceCode: "private-device-code",
      processIdentity: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
    });
    expect(service.interaction()).toEqual({ status: "none" });
    expect(interactionEvents.at(-1)).toEqual({ status: "none" });
  });

  it("caps emitted output and cancels the exact process tree", async () => {
    const fixture = createFixture();
    const service = new TaskProcessSessionService({
      launcher: fixture.launcher,
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: fixture.terminate
    });
    const bounded = service.run(makeRequest(fixture), new AbortController().signal);
    fixture.child.stdout.write("x".repeat(300_000));
    fixture.child.emit("close", 0, null);
    await expect(bounded).resolves.toMatchObject({
      status: "completed",
      outputBytes: 256 * 1_024,
      truncated: true
    });

    const second = createFixture();
    const cancelledService = new TaskProcessSessionService({
      launcher: second.launcher,
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: second.terminate
    });
    const controller = new AbortController();
    const cancelled = cancelledService.run(makeRequest(second), controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "task_process.cancelled" });
    expect(second.terminate).toHaveBeenCalledOnce();
    expect(second.terminate).toHaveBeenCalledWith(second.child as unknown as ChildProcess);

    const third = createFixture();
    const jobCancellation = new TaskProcessSessionService({
      launcher: third.launcher,
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: third.terminate
    });
    const active = jobCancellation.run(makeRequest(third), new AbortController().signal);
    expect(jobCancellation.cancelJob("job_20260727_feishu01")).toBe(true);
    expect(third.terminate).toHaveBeenCalledWith(third.child as unknown as ChildProcess);
    third.child.emit("close", null, "SIGTERM");
    await expect(active).resolves.toMatchObject({ status: "failed" });
  });

  it("adopts only an exact proven interrupted result and never spawns during recovery", async () => {
    const fixture = createFixture();
    const service = new TaskProcessSessionService({
      launcher: fixture.launcher,
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: fixture.terminate
    });
    const request = makeRequest(fixture);
    const checkpoint = {
      planId: request.planId,
      jobId: request.jobId,
      stepOrdinal: request.stepOrdinal,
      revision: request.revision,
      processIdentity: `sha256:${"a".repeat(64)}`
    } as const;
    const adopt = vi.fn(async () => ({
      status: "completed" as const,
      stdout: "probe adopted",
      stderr: "",
      exitCode: 0,
      signal: null,
      outputBytes: 13,
      truncated: false
    }));

    await expect(service.adoptInterrupted(request, checkpoint, { adopt })).resolves.toMatchObject({ status: "completed" });
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({
      planId: request.planId,
      jobId: request.jobId,
      stepOrdinal: request.stepOrdinal,
      revision: request.revision,
      processIdentity: checkpoint.processIdentity,
      executableIdentity: request.command.executableIdentity
    }));
    expect(fixture.launches).toEqual([]);

    await expect(service.adoptInterrupted(request, checkpoint, { adopt: async () => undefined }))
      .rejects.toMatchObject({ code: "task_process.adoption_unavailable" });
    expect(fixture.launches).toEqual([]);
  });

  it("rejects an OAuth origin outside the exact reviewed set", async () => {
    const fixture = createFixture();
    const service = new TaskProcessSessionService({
      launcher: fixture.launcher,
      openBrowserOAuth: vi.fn(),
      terminateProcessTree: fixture.terminate
    });
    const completion = service.run(makeRequest(fixture, {
      interaction: { kind: "browser_oauth", allowedOrigins: ["https://accounts.feishu.cn"] }
    }), new AbortController().signal);

    fixture.child.stdout.write(JSON.stringify({
      type: "browser_oauth",
      url: "https://attacker.invalid/device",
      deviceCode: "secret"
    }) + "\n");
    expect(fixture.terminate).toHaveBeenCalledOnce();
    fixture.child.emit("close", null, "SIGTERM");
    await expect(completion).rejects.toMatchObject({ code: "task_process.interaction_invalid" });
  });
});

interface FakeFixture {
  readonly root: string;
  readonly child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; pid: undefined; kill: ReturnType<typeof vi.fn> };
  readonly launches: Array<{ executable: string; args: readonly string[]; options: CommandProcessLaunchOptions }>;
  readonly launcher: CommandProcessLauncher;
  readonly terminate: ReturnType<typeof vi.fn>;
  readonly command: ReturnType<CommandExecutionService["normalize"]>;
}

function createFixture(): FakeFixture {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "pige-task-process-")));
  roots.push(root);
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: undefined as undefined,
    kill: vi.fn(() => true)
  });
  const launches: FakeFixture["launches"] = [];
  const launcher: CommandProcessLauncher = {
    spawn: (executable, args, options) => {
      launches.push({ executable, args, options });
      return child as unknown as ChildProcess;
    }
  };
  const command = new CommandExecutionService().normalize({
    executable: process.execPath,
    args: ["--version"],
    workingDirectory: root,
    timeoutMs: 30_000
  });
  return { root, child, launches, launcher, terminate: vi.fn(), command };
}

function makeRequest(
  fixture: FakeFixture,
  overrides: Partial<TaskProcessSessionRequest> = {}
): TaskProcessSessionRequest {
  return {
    planId: "plan_0123456789abcdef0123456789abcdef",
    jobId: "job_20260727_feishu01",
    stepOrdinal: 4,
    revision: 7,
    command: fixture.command,
    environment: { HOME: fixture.root, PATH: path.dirname(process.execPath) },
    assertCurrent: vi.fn(),
    ...overrides
  };
}
