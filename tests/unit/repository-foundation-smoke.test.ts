import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertBodyFreeGeneratedReport,
  assertGeneratedReportEnvelope,
  generatedReportPath,
  writeGeneratedReport
} from "../../scripts/verify/generated-report-contract.mjs";
import {
  assertRepositoryFoundationReport,
  FOUNDATION_CHECKS,
  FOUNDATION_RECIPE,
  runRepositoryFoundationSmoke
} from "../../scripts/verify/repository-foundation-smoke.mjs";
import {
  createDevelopmentLaunchEnvironment,
  isDevelopmentRendererTarget,
  runDevelopmentLaunchSmoke,
  shouldAllowDevelopmentSmokeNoSandbox,
  terminateProcessTree
} from "../../scripts/verify/development-launch-smoke.mjs";

const temporaryRoots: string[] = [];
const repositoryRoot = process.cwd();

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("repository foundation smoke", () => {
  it("runs every exact root check and writes one canonical body-free generated report", () => {
    const root = createRoot();
    const invoked: string[] = [];
    const { report, reportPath } = runRepositoryFoundationSmoke({
      root,
      platform: "test-x64",
      buildId: "abc123",
      generatedAt: "2026-07-15T00:00:00.000Z",
      runCheck(check: { id: string }) {
        invoked.push(check.id);
        return true;
      }
    });

    expect(invoked).toEqual(FOUNDATION_CHECKS.map((check) => check.id));
    expect(report.status).toBe("passed");
    expect(reportPath).toBe(generatedReportPath(root, "repository-foundation", "test-x64", "abc123"));
    expect(JSON.parse(fs.readFileSync(reportPath, "utf8"))).toEqual(report);
    if (process.platform !== "win32") expect(fs.statSync(reportPath).mode & 0o777).toBe(0o600);
    expect(() => assertRepositoryFoundationReport(report)).not.toThrow();
  });

  it("fails closed at the first failed command and marks later checks not run", () => {
    const root = createRoot();
    const { report } = runRepositoryFoundationSmoke({
      root,
      platform: "test-x64",
      buildId: "failed-run",
      generatedAt: "2026-07-15T00:00:00.000Z",
      runCheck(check: { id: string }) {
        return check.id !== "typecheck";
      }
    });

    expect(report.status).toBe("failed");
    expect(report.checks).toEqual([
      { id: "format_check", status: "passed" },
      { id: "typecheck", status: "failed" },
      { id: "unit_tests", status: "not_run" },
      { id: "production_build", status: "not_run" },
      { id: "development_electron_launch", status: "not_run" }
    ]);
  });

  it("turns a runner exception into a body-free failed report", () => {
    const root = createRoot();
    const { report } = runRepositoryFoundationSmoke({
      root,
      platform: "test-x64",
      buildId: "thrown-run",
      generatedAt: "2026-07-15T00:00:00.000Z",
      runCheck() {
        throw new Error("/Users/alice/private.txt opaque failure body");
      }
    });

    expect(report.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain("alice");
    expect(report.checks[0]).toEqual({ id: "format_check", status: "failed" });
  });

  it("rejects unsafe report identities, private fields, absolute paths, and stale recipes", () => {
    expect(() => generatedReportPath("/repo", "../escape", "test-x64", "build")).toThrow(/safe segment/u);
    expect(() => assertBodyFreeGeneratedReport({ stdout: "safe-looking output" })).toThrow(/forbidden field stdout/u);
    expect(() => assertBodyFreeGeneratedReport({ api_key: "opaque" })).toThrow(/forbidden field api_key/u);
    for (const absolutePath of [
      "/secret",
      "path=/Users/alice/private.txt",
      "C:\\Users\\alice\\private.txt",
      "\\\\server\\share\\private.txt",
      "//server/share/private.txt",
      "\\Users\\alice\\private.txt",
      "\\\\?\\C:\\Users\\alice\\private.txt",
      "file:///Users/alice/private.txt",
      "file://server/share/private.txt"
    ]) {
      expect(() => assertBodyFreeGeneratedReport({ detail: absolutePath })).toThrow(/absolute path/u);
    }

    const report = passingReport();
    expect(() => assertGeneratedReportEnvelope(report, "scripts/verify/other.mjs")).toThrow(/recipe identity/u);
    expect(() => assertRepositoryFoundationReport({ ...report, extra: true })).toThrow(/not canonical/u);
  });

  it("runs and uploads the exact report from the root CI gate", () => {
    const workflow = fs.readFileSync(path.join(repositoryRoot, ".github/workflows/ci.yml"), "utf8");
    const rootPackage = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"));
    expect(rootPackage.scripts.dev).toBe(
      "tsc -b tsconfig.packages.json --pretty false && install-electron --no && npm run dev --workspace @pige/desktop"
    );
    expect(rootPackage.scripts.build).toBe(
      "tsc -b tsconfig.packages.json --pretty false --force && npm run build --workspace @pige/desktop"
    );
    expect(workflow).toContain("xvfb-run -a npm run smoke:repository-foundation");
    expect(workflow).toContain("PIGE_REPORT_BUILD_ID: ${{ github.sha }}");
    expect(workflow).toContain('PIGE_DEVELOPMENT_SMOKE_NO_SANDBOX: "1"');
    expect(workflow).toContain(
      "artifacts/test-reports/repository-foundation/linux-x64/${{ github.sha }}/report.json"
    );
    expect(workflow).toContain("actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a");
    expect(workflow).toContain("if: always()");
    expect(FOUNDATION_CHECKS.at(-1)?.args).toEqual(["run", "smoke:development-launch"]);
  });

  it("isolates development launch state and requires a loopback renderer target", () => {
    const environment = createDevelopmentLaunchEnvironment(
      {
        PATH: "/usr/bin",
        OPENAI_API_KEY: "secret",
        CSC_LINK: "secret",
        ELECTRON_CLI_ARGS: '["--inspect=unsafe"]',
        ELECTRON_MIRROR: "https://mirror.invalid/",
        ELECTRON_OVERRIDE_DIST_PATH: "/tmp/untrusted-electron",
        electron_use_remote_checksums: "1",
        NO_SANDBOX: "1",
        no_sandbox: "1",
        No_Sandbox: "1",
        PIGE_DEVELOPMENT_SMOKE_NO_SANDBOX: "1",
        pige_development_smoke_no_sandbox: "1",
        npm_config_electron_mirror: "https://mirror.invalid/",
        npm_config_electron_use_remote_checksums: "1",
        npm_config_platform: "win32"
      },
      9321,
      "/tmp/pige-user-data"
    );
    expect(environment).toEqual({
      PATH: "/usr/bin",
      REMOTE_DEBUGGING_PORT: "9321",
      ELECTRON_CLI_ARGS: '["--user-data-dir=/tmp/pige-user-data"]'
    });
    expect(
      createDevelopmentLaunchEnvironment(
        { PATH: "/usr/bin", no_sandbox: "inherited", Pige_Development_Smoke_No_Sandbox: "inherited" },
        9321,
        "/tmp/pige-user-data",
        { allowNoSandbox: true }
      )
    ).toEqual({
      PATH: "/usr/bin",
      REMOTE_DEBUGGING_PORT: "9321",
      ELECTRON_CLI_ARGS: '["--user-data-dir=/tmp/pige-user-data"]',
      NO_SANDBOX: "1"
    });
    const githubEnvironment = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      PIGE_DEVELOPMENT_SMOKE_NO_SANDBOX: "1"
    };
    expect(shouldAllowDevelopmentSmokeNoSandbox("linux", githubEnvironment)).toBe(true);
    expect(shouldAllowDevelopmentSmokeNoSandbox("darwin", githubEnvironment)).toBe(false);
    expect(shouldAllowDevelopmentSmokeNoSandbox("linux", { ...githubEnvironment, CI: "false" })).toBe(false);
    expect(shouldAllowDevelopmentSmokeNoSandbox("linux", { ...githubEnvironment, GITHUB_ACTIONS: "false" })).toBe(false);
    expect(shouldAllowDevelopmentSmokeNoSandbox("linux", { ...githubEnvironment, PIGE_DEVELOPMENT_SMOKE_NO_SANDBOX: "0" })).toBe(false);
    expect(
      isDevelopmentRendererTarget({
        type: "page",
        url: "http://localhost:5173/",
        webSocketDebuggerUrl: "ws://127.0.0.1:9321/devtools/page/1"
      })
    ).toBe(true);
    expect(
      isDevelopmentRendererTarget({
        type: "page",
        url: "file:///private/tmp/fake.html",
        webSocketDebuggerUrl: "ws://127.0.0.1:9321/devtools/page/1"
      })
    ).toBe(false);
  });

  it("maps initialization failures to one body-free launch stage", async () => {
    const stages: string[] = [];
    const ready = await runDevelopmentLaunchSmoke({
      reservePort: async () => {
        throw new Error("path=/Users/alice/private.txt");
      },
      onFailureStage(stage: string) {
        stages.push(stage);
      }
    });
    expect(ready).toBe(false);
    expect(stages).toEqual(["launcher_error"]);
    expect(JSON.stringify(stages)).not.toContain("alice");
  });

  it("terminates descendants after the development launcher exits", async () => {
    if (process.platform === "win32") {
      const source = fs.readFileSync(path.join(repositoryRoot, "scripts/verify/development-launch-smoke.mjs"), "utf8");
      expect(source).toContain('spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"]');
      expect(source).not.toContain("child.exitCode !== null || child.signalCode !== null) return;");
      return;
    }

    const root = createRoot();
    const markerPath = path.join(root, "descendant.pid");
    const launcher = spawn(
      process.execPath,
      [
        "-e",
        [
          "const {spawn}=require('node:child_process')",
          "const fs=require('node:fs')",
          "const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'})",
          `fs.writeFileSync(${JSON.stringify(markerPath)},String(child.pid))`,
          "setTimeout(()=>process.exit(0),50)"
        ].join(";")
      ],
      { detached: true, stdio: "ignore" }
    );
    await once(launcher, "exit");
    const descendantPid = Number(fs.readFileSync(markerPath, "utf8"));
    expect(processIsAlive(descendantPid)).toBe(true);

    await terminateProcessTree(launcher);

    await waitUntil(() => !processIsAlive(descendantPid));
    expect(processIsAlive(descendantPid)).toBe(false);
  });

  it("rejects a symlinked generated-report parent", () => {
    if (process.platform === "win32") return;
    const root = createRoot();
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "pige-foundation-external-"));
    temporaryRoots.push(external);
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    fs.symlinkSync(external, path.join(root, "artifacts", "test-reports"));
    expect(() =>
      runRepositoryFoundationSmoke({
        root,
        platform: "test-x64",
        buildId: "symlink-parent",
        generatedAt: "2026-07-15T00:00:00.000Z",
        runCheck: () => true
      })
    ).toThrow(/real directory|escaped/u);
    expect(fs.readdirSync(external)).toEqual([]);
  });

  it("rejects temporary-file, parent, and destination successors without deleting them", () => {
    if (process.platform === "win32") return;

    const temporaryRoot = createRoot();
    const temporaryReport = generatedReportPath(temporaryRoot, "repository-foundation", "test-x64", "temp-swap");
    let successorTemporaryPath = "";
    expect(() =>
      writeGeneratedReport(temporaryRoot, temporaryReport, passingReport(), {
        beforeCommit({ temporaryPath }: { temporaryPath: string }) {
          successorTemporaryPath = temporaryPath;
          fs.rmSync(temporaryPath);
          fs.writeFileSync(temporaryPath, "attacker bytes", { flag: "wx" });
        }
      })
    ).toThrow(/temporary file identity changed/u);
    expect(fs.readFileSync(successorTemporaryPath, "utf8")).toBe("attacker bytes");
    expect(fs.existsSync(temporaryReport)).toBe(false);

    const parentRoot = createRoot();
    const parentReport = generatedReportPath(parentRoot, "repository-foundation", "test-x64", "parent-swap");
    const external = fs.mkdtempSync(path.join(os.tmpdir(), "pige-foundation-parent-external-"));
    temporaryRoots.push(external);
    expect(() =>
      writeGeneratedReport(parentRoot, parentReport, passingReport(), {
        beforeCommit({ reportPath }: { reportPath: string }) {
          const parent = path.dirname(reportPath);
          fs.renameSync(parent, `${parent}-original`);
          fs.symlinkSync(external, parent);
        }
      })
    ).toThrow(/parent identity changed|real directory/u);
    expect(fs.readdirSync(external)).toEqual([]);

    const destinationRoot = createRoot();
    const destinationReport = generatedReportPath(
      destinationRoot,
      "repository-foundation",
      "test-x64",
      "destination-swap"
    );
    fs.mkdirSync(path.dirname(destinationReport), { recursive: true });
    fs.writeFileSync(destinationReport, "original report", "utf8");
    expect(() =>
      writeGeneratedReport(destinationRoot, destinationReport, passingReport(), {
        beforeCommit({ reportPath }: { reportPath: string }) {
          fs.rmSync(reportPath);
          fs.writeFileSync(reportPath, "successor report", { flag: "wx" });
        }
      })
    ).toThrow(/destination identity changed/u);
    expect(fs.readFileSync(destinationReport, "utf8")).toBe("successor report");

    const publicationRoot = createRoot();
    const publicationReport = generatedReportPath(
      publicationRoot,
      "repository-foundation",
      "test-x64",
      "publication-swap"
    );
    fs.mkdirSync(path.dirname(publicationReport), { recursive: true });
    fs.writeFileSync(publicationReport, "original report", "utf8");
    expect(() =>
      writeGeneratedReport(publicationRoot, publicationReport, passingReport(), {
        beforeRename({ reportPath }: { reportPath: string }) {
          fs.writeFileSync(reportPath, "late successor report", { flag: "wx" });
        }
      })
    ).toThrow(/destination appeared before publication/u);
    expect(fs.readFileSync(publicationReport, "utf8")).toBe("late successor report");
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-foundation-smoke-"));
  temporaryRoots.push(root);
  const recipePath = path.join(root, FOUNDATION_RECIPE);
  fs.mkdirSync(path.dirname(recipePath), { recursive: true });
  fs.writeFileSync(recipePath, "synthetic recipe\n", "utf8");
  return root;
}

function passingReport() {
  const recipeSha256 = crypto.createHash("sha256").update("synthetic recipe\n").digest("hex");
  return {
    schemaVersion: 1,
    status: "passed",
    generatedAt: "2026-07-15T00:00:00.000Z",
    recipe: FOUNDATION_RECIPE,
    recipeSha256,
    platform: "test-x64",
    buildId: "abc123",
    checks: FOUNDATION_CHECKS.map(({ id }) => ({ id, status: "passed" }))
  };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
