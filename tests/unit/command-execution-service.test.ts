import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirstPartyCommandCapabilityAdapter } from "../../apps/desktop/src/main/services/command-capability-adapter";
import {
  CommandExecutionService,
  MAX_COMMAND_OUTPUT_BYTES
} from "../../apps/desktop/src/main/services/command-execution-service";
import { HighRiskConfirmationService } from "../../apps/desktop/src/main/services/high-risk-confirmation-service";
import { PermissionBrokerService } from "../../apps/desktop/src/main/services/permission-broker-service";
import { PermissionedExternalCapabilityRegistry } from "../../apps/desktop/src/main/services/permissioned-external-capability-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("CommandExecutionService", () => {
  it("runs an exact executable and argument array without a shell", async () => {
    const root = tempRoot();
    const service = new CommandExecutionService({
      environment: { ...process.env, PIGE_SECRET_SENTINEL: "must-not-cross" }
    });
    const request = service.normalize({
      executable: process.execPath,
      args: ["-e", "process.stdout.write(JSON.stringify({args:process.argv.slice(1),secret:process.env.PIGE_SECRET_SENTINEL??null,cwd:process.cwd()}))", "hello;not-shell"],
      workingDirectory: root
    });

    const result = await service.execute(request, new AbortController().signal);

    expect(result.status).toBe("completed");
    expect(JSON.parse(result.stdout)).toEqual({
      args: ["hello;not-shell"],
      secret: null,
      cwd: fs.realpathSync.native(root)
    });
    expect(result.stderr).toBe("");
  });

  it("allows an explicitly requested shell executable", async () => {
    if (process.platform === "win32") return;
    const service = new CommandExecutionService();
    const request = service.normalize({
      executable: "/bin/sh",
      args: ["-c", "printf 'shell-ok'"]
    });

    await expect(service.execute(request, new AbortController().signal)).resolves.toMatchObject({
      status: "completed",
      stdout: "shell-ok"
    });
  });

  it("bounds output and terminates timed-out commands", async () => {
    const service = new CommandExecutionService();
    const output = service.normalize({
      executable: process.execPath,
      args: ["-e", `process.stdout.write("x".repeat(${MAX_COMMAND_OUTPUT_BYTES + 64}))`]
    });
    const timed = service.normalize({
      executable: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 30000)"],
      timeoutMs: 1_000
    });

    await expect(service.execute(output, new AbortController().signal)).resolves.toMatchObject({
      status: "completed",
      outputBytes: MAX_COMMAND_OUTPUT_BYTES,
      truncated: true
    });
    await expect(service.execute(timed, new AbortController().signal)).resolves.toMatchObject({
      status: "timed_out"
    });
  });

  it("publishes one general OS command tool instead of package-specific capability gaps", () => {
    const adapter = createFirstPartyCommandCapabilityAdapter();
    expect(adapter.tool).toMatchObject({
      name: "pige_run_command",
      ownerService: "CommandExecutionService",
      effect: "idempotent_write"
    });
    expect(adapter.permission).toMatchObject({
      capability: "run_shell",
      dataBoundary: "local"
    });
    expect(adapter.normalizeInput({
      executable: process.execPath,
      args: ["--version"]
    })).toMatchObject({
      executable: fs.realpathSync.native(process.execPath),
      args: ["--version"]
    });
  });

  it("binds the normalized executable to canonical confirmation before command execution", async () => {
    const root = tempRoot();
    const machineRoot = path.join(root, "machine");
    const vaultPath = path.join(root, "vault");
    fs.mkdirSync(machineRoot);
    fs.mkdirSync(vaultPath);
    const commands = new CommandExecutionService();
    const execute = vi.spyOn(commands, "execute").mockResolvedValue({
      status: "completed",
      stdout: "",
      stderr: "",
      exitCode: 0,
      signal: null,
      outputBytes: 0,
      truncated: false
    });
    const confirmations = new HighRiskConfirmationService();
    const broker = new PermissionBrokerService({
      rootPath: machineRoot,
      unsafeAllowUnfenced: true,
      confirmations
    });
    const registry = new PermissionedExternalCapabilityRegistry([
      createFirstPartyCommandCapabilityAdapter(commands)
    ], broker);
    const [tool] = registry.toolsForTurn({
      vaultPath,
      vaultId: "vault_20260722_command01",
      jobId: "job_20260722_command01",
      policyContextId: "policy_context_command",
      policyHash: digest("command policy"),
      runtimeKind: "desktop_local",
      clientCapabilityTier: "desktop_full",
      confirmationOwner: { kind: "agent_turn", clientTurnId: "turn_20260722_command01abcd" },
      assertCurrent: vi.fn()
    });
    if (!tool) throw new Error("Expected command tool.");

    const deniedController = new AbortController();
    const denied = tool.execute({ executable: process.execPath, args: ["--version"] }, deniedController.signal, {
      toolCallId: "tool_call_command_denied",
      signal: deniedController.signal
    });
    await vi.waitFor(() => expect(confirmations.pending()).toMatchObject({
      status: "pending",
      confirmation: {
        effect: "arbitrary_shell",
        presentation: {
          subject: { kind: "executable_name", value: path.basename(fs.realpathSync.native(process.execPath)) }
        }
      }
    }));
    const deniedPending = confirmations.pending();
    if (deniedPending.status !== "pending") throw new Error("Expected command confirmation.");
    await confirmations.resolve({
      apiVersion: 1,
      confirmationId: deniedPending.confirmation.confirmationId,
      expectedRevision: deniedPending.revision,
      decision: "deny"
    });
    await expect(denied).rejects.toMatchObject({ code: "permission.denied" });
    await expect(confirmations.resolve({
      apiVersion: 1,
      confirmationId: deniedPending.confirmation.confirmationId,
      expectedRevision: deniedPending.revision,
      decision: "allow"
    })).resolves.toMatchObject({ status: "stale" });
    expect(execute).not.toHaveBeenCalled();

    const allowedExecutable = process.platform === "win32" ? process.env.ComSpec! : "/bin/sh";
    const allowedController = new AbortController();
    const allowed = tool.execute({ executable: allowedExecutable }, allowedController.signal, {
      toolCallId: "tool_call_command_allowed",
      signal: allowedController.signal
    });
    await vi.waitFor(() => expect(confirmations.pending()).toMatchObject({ status: "pending" }));
    const allowedPending = confirmations.pending();
    if (allowedPending.status !== "pending") throw new Error("Expected changed command confirmation.");
    expect(allowedPending.confirmation.confirmationId).not.toBe(deniedPending.confirmation.confirmationId);
    expect(allowedPending.confirmation.presentation.subject).toEqual({
      kind: "executable_name",
      value: path.basename(fs.realpathSync.native(allowedExecutable))
    });
    await confirmations.resolve({
      apiVersion: 1,
      confirmationId: allowedPending.confirmation.confirmationId,
      expectedRevision: allowedPending.revision,
      decision: "allow"
    });
    await expect(allowed).resolves.toMatchObject({ details: { status: "completed" } });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.runIf(process.env.PIGE_RUN_CLI_INSTALL_EVIDENCE === "1")(
    "installs and invokes the Feishu CLI in an isolated prefix",
    async () => {
      const root = tempRoot();
      const service = new CommandExecutionService();
      const install = service.normalize({
        executable: "npm",
        args: ["install", "--prefix", root, "@larksuite/cli@1.0.72"],
        timeoutMs: 180_000
      });
      const installed = await service.execute(install, new AbortController().signal);
      expect(installed).toMatchObject({ status: "completed", exitCode: 0 });

      const cli = service.normalize({
        executable: path.join(root, "node_modules", ".bin", process.platform === "win32" ? "lark-cli.cmd" : "lark-cli"),
        args: ["--version"],
        timeoutMs: 30_000
      });
      const invoked = await service.execute(cli, new AbortController().signal);
      expect(invoked).toMatchObject({ status: "completed", exitCode: 0 });
      expect(`${invoked.stdout}\n${invoked.stderr}`).toMatch(/1\.0\.72/u);
    },
    240_000
  );
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-command-execution-"));
  roots.push(root);
  return root;
}

function digest(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}
