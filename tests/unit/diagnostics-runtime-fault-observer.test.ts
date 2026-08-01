import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import type { App } from "electron";
import { afterEach, describe, expect, it } from "vitest";
import { installDiagnosticsRuntimeFaultObserver } from "../../apps/desktop/src/main/services/diagnostics-runtime-fault-observer";
import { DiagnosticsService } from "../../apps/desktop/src/main/services/diagnostics-service";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("diagnostics runtime fault observer", () => {
  it("installs the observer after diagnostics initialization and disposes it before quit", () => {
    const main = fs.readFileSync(path.resolve("apps/desktop/src/main/index.ts"), "utf8");
    expect(main).toContain("disposeDiagnosticsRuntimeFaultObserver = installDiagnosticsRuntimeFaultObserver({");
    expect(main).toContain("disposeDiagnosticsRuntimeFaultObserver?.();");
    expect(main.indexOf("disposeDiagnosticsRuntimeFaultObserver?.();"))
      .toBeLessThan(main.indexOf("diagnosticsLifecycleService?.close();"));
  });

  it("records only fixed bounded Main, renderer, and child fault facts and disposes exactly", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-runtime-faults-"));
    roots.push(root);
    const appEvents = new EventEmitter();
    const processEvents = new EventEmitter();
    const diagnostics = new DiagnosticsService(root, { maxAppEventBytes: 4_096, maxSegmentBytes: 1_024 });
    const dispose = installDiagnosticsRuntimeFaultObserver({
      app: appEvents as unknown as App,
      process: processEvents as unknown as NodeJS.Process,
      diagnostics
    });

    processEvents.emit("uncaughtExceptionMonitor", new Error("sk-secret /Users/alice/private.md"), "unhandledRejection");
    appEvents.emit("render-process-gone", {}, { getURL: () => "https://private.example.test" }, {
      reason: "crashed", exitCode: 9
    });
    appEvents.emit("child-process-gone", {}, {
      reason: "oom", exitCode: 137, type: "Utility", name: "Private Customer Tool", serviceName: "secret-service"
    });
    appEvents.emit("render-process-gone", {}, {}, { reason: "clean-exit", exitCode: 0 });

    dispose();
    dispose();
    appEvents.emit("child-process-gone", {}, { reason: "crashed", exitCode: 1, type: "GPU" });

    const content = fs.readFileSync(path.join(root, "diagnostics", "app-events.jsonl"), "utf8");
    const events = content.trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toHaveLength(3);
    expect(events.map(({ code }) => code)).toEqual([
      "runtime.main_process_fault",
      "runtime.renderer_process_gone",
      "runtime.child_process_gone"
    ]);
    expect(events.map(({ message }) => message)).toEqual([
      "The Main process encountered an unhandled runtime fault.",
      "A renderer process stopped unexpectedly.",
      "A child process stopped unexpectedly."
    ]);
    expect(events[0]?.redactedDetails).toEqual({ kind: "unhandled_rejection" });
    expect(events[1]?.redactedDetails).toEqual({ kind: "crashed", exitCode: 9 });
    expect(events[2]?.redactedDetails).toEqual({ kind: "oom", type: "utility", exitCode: 137 });
    for (const privateValue of ["sk-secret", "/Users/alice", "private.example", "Private Customer Tool", "secret-service"]) {
      expect(content).not.toContain(privateValue);
    }
    expect(processEvents.listenerCount("uncaughtExceptionMonitor")).toBe(0);
    expect(appEvents.listenerCount("render-process-gone")).toBe(0);
    expect(appEvents.listenerCount("child-process-gone")).toBe(0);
  });

  it("never throws from a runtime fault when the diagnostics store is unavailable", () => {
    const appEvents = new EventEmitter();
    const processEvents = new EventEmitter();
    installDiagnosticsRuntimeFaultObserver({
      app: appEvents as unknown as App,
      process: processEvents as unknown as NodeJS.Process,
      diagnostics: { recordEvent: () => { throw new Error("store unavailable"); } }
    });
    expect(() => processEvents.emit("uncaughtExceptionMonitor", new Error("private"), "uncaughtException"))
      .not.toThrow();
  });
});
