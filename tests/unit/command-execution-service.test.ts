import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFirstPartyCommandCapabilityAdapter } from "../../apps/desktop/src/main/services/command-capability-adapter";
import {
  CommandExecutionService,
  MAX_COMMAND_OUTPUT_BYTES
} from "../../apps/desktop/src/main/services/command-execution-service";

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
