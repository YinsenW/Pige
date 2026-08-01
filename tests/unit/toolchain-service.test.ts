import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolchainService } from "../../apps/desktop/src/main/services/toolchain-service";

const tempRoots: string[] = [];

function makeManifest(tools: unknown[]): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-toolchain-test-"));
  tempRoots.push(root);
  const manifestPath = path.join(root, "toolchain.manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify({ schemaVersion: 1, tools }, null, 2)}\n`, "utf8");
  return manifestPath;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("toolchain service", () => {
  it("reports needs_repair when required bundled tools are missing", () => {
    const manifestPath = makeManifest([
      {
        id: "git",
        name: "Git",
        required: true,
        bundledPath: "missing/git",
        repairHint: "Install bundled Git."
      }
    ]);

    const health = new ToolchainService(manifestPath).health();

    expect(health.status).toBe("needs_repair");
    expect(health.tools[0]).toMatchObject({
      id: "git",
      status: "missing",
      repairHint: "Install bundled Git."
    });
  });

  it("reports ready when required bundled tools resolve", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-toolchain-ready-test-"));
    tempRoots.push(root);
    const toolPath = path.join(root, "bin/tool");
    fs.mkdirSync(path.dirname(toolPath), { recursive: true });
    fs.writeFileSync(toolPath, "ok", "utf8");
    const manifestPath = path.join(root, "toolchain.manifest.json");
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify({ schemaVersion: 1, tools: [{ id: "tool", name: "Tool", required: true, bundledPath: "bin/tool" }] }, null, 2)}\n`,
      "utf8"
    );

    expect(new ToolchainService(manifestPath).health().status).toBe("ready");
  });

  it("checks bundled modules without exposing their absolute install path", () => {
    const manifestPath = makeManifest([
      {
        id: "pdf-parser",
        name: "PDF parser",
        required: true,
        bundledModule: "pdfjs-dist/package.json"
      }
    ]);

    const health = new ToolchainService(manifestPath, (moduleId) => `/private/node_modules/${moduleId}`).health();

    expect(health.status).toBe("ready");
    expect(health.tools[0]).toMatchObject({ id: "pdf-parser", status: "ready" });
    expect(health.tools[0]?.resolvedPath).toBeUndefined();
  });

  it("accepts a public package root when package exports hide package.json", () => {
    const manifestPath = makeManifest([
      {
        id: "office-openxml-parser",
        name: "OpenXML parser",
        required: true,
        bundledModule: "fast-xml-parser/package.json"
      }
    ]);
    const requested: string[] = [];
    const health = new ToolchainService(manifestPath, (moduleId) => {
      requested.push(moduleId);
      if (moduleId.endsWith("/package.json")) throw new Error("ERR_PACKAGE_PATH_NOT_EXPORTED");
      return `/private/node_modules/${moduleId}/lib/fxp.cjs`;
    }).health();

    expect(health.status).toBe("ready");
    expect(health.tools[0]).toMatchObject({ id: "office-openxml-parser", status: "ready" });
    expect(requested).toEqual(["fast-xml-parser/package.json", "fast-xml-parser"]);
  });

  it("reports a missing bundled module through the same repair contract", () => {
    const manifestPath = makeManifest([
      {
        id: "pdf-parser",
        name: "PDF parser",
        required: true,
        bundledModule: "missing-parser/package.json",
        repairHint: "Repair the application installation."
      }
    ]);

    const health = new ToolchainService(manifestPath, () => {
      throw new Error("missing");
    }).health();

    expect(health.status).toBe("needs_repair");
    expect(health.tools[0]).toMatchObject({ status: "missing", repairHint: "Repair the application installation." });
  });

  it("requeues preserved parser work after an explicit healthy recheck without duplicate scheduling", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-toolchain-recovery-test-"));
    tempRoots.push(root);
    const toolPath = path.join(root, "bin/tool");
    fs.mkdirSync(path.dirname(toolPath), { recursive: true });
    fs.writeFileSync(toolPath, "ok", "utf8");
    const manifestPath = path.join(root, "toolchain.manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      tools: [{ id: "parser", name: "Parser", required: true, bundledPath: "bin/tool" }]
    })}\n`, "utf8");
    const scheduleParseProcessing = vi.fn();
    const scheduleAgentIngestProcessing = vi.fn();
    let first = true;
    const dependencies = {
      hasActiveVault: () => true,
      requeueWaitingParses: vi.fn(() => ({ requeued: first ? 2 : 0 })),
      requeueWaitingAgentIngest: vi.fn(() => ({ requeued: first ? 1 : 0 })),
      scheduleParseProcessing,
      scheduleAgentIngestProcessing,
      onRecoveryFailure: vi.fn()
    };
    const service = new ToolchainService(manifestPath);

    expect(service.recheckAndRecover(dependencies).status).toBe("ready");
    first = false;
    expect(service.recheckAndRecover(dependencies).status).toBe("ready");

    expect(dependencies.requeueWaitingParses).toHaveBeenCalledTimes(2);
    expect(dependencies.requeueWaitingAgentIngest).toHaveBeenCalledTimes(2);
    expect(scheduleParseProcessing).toHaveBeenCalledTimes(1);
    expect(scheduleAgentIngestProcessing).toHaveBeenCalledTimes(1);
  });

  it("never inspects vault jobs when the toolchain or active vault is unavailable", () => {
    const manifestPath = makeManifest([{
      id: "parser",
      name: "Parser",
      required: true,
      bundledPath: "missing/parser"
    }]);
    const requeueWaitingParses = vi.fn(() => ({ requeued: 1 }));
    const dependencies = {
      hasActiveVault: vi.fn(() => true),
      requeueWaitingParses,
      requeueWaitingAgentIngest: vi.fn(() => ({ requeued: 1 })),
      scheduleParseProcessing: vi.fn(),
      scheduleAgentIngestProcessing: vi.fn(),
      onRecoveryFailure: vi.fn()
    };

    expect(new ToolchainService(manifestPath).recheckAndRecover(dependencies).status).toBe("needs_repair");
    expect(dependencies.hasActiveVault).not.toHaveBeenCalled();
    expect(requeueWaitingParses).not.toHaveBeenCalled();

    const readyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-toolchain-no-vault-test-"));
    tempRoots.push(readyRoot);
    const toolPath = path.join(readyRoot, "tool");
    fs.writeFileSync(toolPath, "ok", "utf8");
    const readyManifest = path.join(readyRoot, "toolchain.manifest.json");
    fs.writeFileSync(readyManifest, `${JSON.stringify({
      schemaVersion: 1,
      tools: [{ id: "parser", name: "Parser", required: true, bundledPath: "tool" }]
    })}\n`, "utf8");
    dependencies.hasActiveVault.mockReturnValue(false);

    expect(new ToolchainService(readyManifest).recheckAndRecover(dependencies).status).toBe("ready");
    expect(requeueWaitingParses).not.toHaveBeenCalled();
  });

  it("keeps independent recovery owners progressing when one preserved queue is damaged", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-toolchain-partial-recovery-test-"));
    tempRoots.push(root);
    const toolPath = path.join(root, "tool");
    fs.writeFileSync(toolPath, "ok", "utf8");
    const manifestPath = path.join(root, "toolchain.manifest.json");
    fs.writeFileSync(manifestPath, `${JSON.stringify({
      schemaVersion: 1,
      tools: [{ id: "parser", name: "Parser", required: true, bundledPath: "tool" }]
    })}\n`, "utf8");
    const scheduleAgentIngestProcessing = vi.fn();
    const onRecoveryFailure = vi.fn();

    expect(new ToolchainService(manifestPath).recheckAndRecover({
      hasActiveVault: () => true,
      requeueWaitingParses: () => { throw new Error("damaged private job record"); },
      requeueWaitingAgentIngest: () => ({ requeued: 1 }),
      scheduleParseProcessing: vi.fn(),
      scheduleAgentIngestProcessing,
      onRecoveryFailure
    }).status).toBe("ready");
    expect(onRecoveryFailure).toHaveBeenCalledExactlyOnceWith("parse");
    expect(scheduleAgentIngestProcessing).toHaveBeenCalledTimes(1);
  });
});
