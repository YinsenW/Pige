import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DiagnosticsExportWorkerService,
  type DiagnosticsExportWorkerFactory
} from "../../apps/desktop/src/main/services/diagnostics-export-worker-service";
import {
  DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
  type DiagnosticsExportWorkerRequest
} from "../../apps/desktop/src/main/services/diagnostics-export-types";

class FakeWorker extends EventEmitter {
  request: DiagnosticsExportWorkerRequest | undefined;
  terminated = false;

  postMessage(value: DiagnosticsExportWorkerRequest): void {
    this.request = value;
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

function serviceWith(worker: FakeWorker, timeoutMs = 100): DiagnosticsExportWorkerService {
  const factory: DiagnosticsExportWorkerFactory = () => worker;
  return new DiagnosticsExportWorkerService({
    workerUrl: new URL("file:///synthetic/diagnostics-export-worker.js"),
    workerFactory: factory,
    timeoutMs
  });
}

function validContent(): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    exportedAt: "2026-07-15T00:00:00.000Z",
    localOnly: true,
    preview: {
      previewId: "support_20260715000000",
      generatedAt: "2026-07-15T00:00:00.000Z",
      includedCategories: [
        { id: "app_runtime", label: "App version, platform, and architecture", included: true, reason: "Needed to diagnose platform-specific failures." },
        { id: "diagnostics_health", label: "Diagnostics health summary", included: true, reason: "Redacted operational status only." },
        { id: "recent_errors", label: "Recent redacted diagnostic events", included: true, reason: "Bounded and redacted event summaries." }
      ],
      excludedCategories: [
        { id: "secrets", label: "API keys, tokens, cookies, and credentials", included: false, reason: "Secrets are never exported by default." },
        { id: "content", label: "Full notes, source files, conversations, memory, prompts, and model responses", included: false, reason: "Support bundles must not duplicate private knowledge content by default." },
        { id: "binaries", label: "Local models, parser binaries, packages, and source artifacts", included: false, reason: "Large binaries and artifacts are excluded." }
      ],
      privacyWarnings: [
        "The bundle is created locally and is not uploaded automatically.",
        "Paths, emails, and common secret patterns are redacted by default.",
        "Review the preview before exporting."
      ]
    },
    app: { platform: "synthetic", arch: "arm64", node: "22.1.0", electron: "unknown" },
    diagnosticsHealth: {
      status: "ok",
      checkedAt: "2026-07-15T00:00:00.000Z",
      localOnly: true,
      recentErrorCount: 0,
      checks: [{ id: "diagnostics_store", status: "ok", message: "Local diagnostics store is writable." }]
    },
    recentEvents: []
  })}\n`;
}

describe("DiagnosticsExportWorkerService", () => {
  it("keeps the built diagnostics worker in the packaged ASAR contract", () => {
    const packageSmoke = fs.readFileSync(path.resolve("scripts/release/packaged-electron-smoke.mjs"), "utf8");
    const workerSmoke = fs.readFileSync(path.resolve("scripts/verify/diagnostics-export-worker-smoke.mjs"), "utf8");
    expect(packageSmoke).toContain('"/out/main/workers/diagnostics-export-worker.js"');
    expect(packageSmoke).toContain('runNodeSmoke("scripts/verify/diagnostics-export-worker-smoke.mjs"');
    expect(packageSmoke).toContain("PIGE_DIAGNOSTICS_EXPORT_WORKER_SMOKE_FAILURE=([a-z_]+)");
    expect(packageSmoke).not.toContain("result.stderr.trim");
    expect(workerSmoke).toContain("installSuccessorOrVerifyWindowsHandleFence");
    expect(workerSmoke).toContain('["EACCES", "EBUSY", "EPERM"]');
    expect(workerSmoke).toContain("successor_descriptor_validation");
  });

  it("accepts only the matching exact success response", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-export-success-"));
    const outputPath = path.join(root, "support.json");
    const worker = new FakeWorker();
    const pending = serviceWith(worker).write({
      outputPath,
      content: validContent()
    });
    const request = worker.request;
    expect(request).toBeDefined();
    try {
      fs.writeFileSync(outputPath, request?.content ?? "", { encoding: "utf8", mode: 0o600 });
      worker.emit("message", {
        protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
        requestId: request?.requestId,
        kind: "success",
        bytesWritten: Buffer.byteLength(request?.content ?? "")
      });

      await expect(pending).resolves.toEqual({ bytesWritten: Buffer.byteLength(request?.content ?? "") });
      expect(worker.terminated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects a success response whose byte count is not exact", async () => {
    const worker = new FakeWorker();
    const pending = serviceWith(worker).write({ outputPath: "/tmp/support.json", content: validContent() });
    worker.emit("message", {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId: worker.request?.requestId,
      kind: "success",
      bytesWritten: Buffer.byteLength(validContent()) - 1
    });

    await expect(pending).rejects.toMatchObject({ code: "diagnostics.export_worker_protocol" });
  });

  it("observes an abort raised while the worker is being constructed", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const service = new DiagnosticsExportWorkerService({
      workerUrl: new URL("file:///synthetic/diagnostics-export-worker.js"),
      workerFactory: () => {
        controller.abort();
        return worker;
      }
    });

    await expect(service.write({
      outputPath: "/tmp/support.json",
      content: validContent()
    }, { signal: controller.signal })).rejects.toMatchObject({ code: "diagnostics.export_canceled" });
    expect(worker.request).toBeUndefined();
    expect(worker.terminated).toBe(true);
  });

  it("fails closed for a mismatched or extended worker response", async () => {
    const worker = new FakeWorker();
    const pending = serviceWith(worker).write({
      outputPath: "/tmp/support.json",
      content: validContent()
    });
    worker.emit("message", {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId: "wrong-request",
      kind: "success",
      bytesWritten: 10,
      rawPath: "/private/tmp/private"
    });

    await expect(pending).rejects.toMatchObject({ code: "diagnostics.export_worker_protocol" });
    expect(worker.terminated).toBe(true);
  });

  it("terminates and fails closed on cancellation", async () => {
    const worker = new FakeWorker();
    const controller = new AbortController();
    const pending = serviceWith(worker).write({
      outputPath: "/tmp/support.json",
      content: validContent()
    }, { signal: controller.signal });
    const temporaryPath = worker.request?.prepared.temporaryPath;
    expect(temporaryPath).toBeDefined();
    fs.writeSync(
      Number(worker.request?.prepared.temporaryDescriptor),
      Buffer.from(validContent().slice(0, 64)),
      0,
      Buffer.byteLength(validContent().slice(0, 64)),
      0
    );
    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "diagnostics.export_canceled" });
    expect(worker.terminated).toBe(true);
    expect(fs.existsSync(String(temporaryPath))).toBe(false);
  });

  it("terminates and fails closed on timeout", async () => {
    const worker = new FakeWorker();
    const pending = serviceWith(worker, 5).write({
      outputPath: "/tmp/support.json",
      content: validContent()
    });

    await expect(pending).rejects.toMatchObject({ code: "diagnostics.export_timeout" });
    expect(worker.terminated).toBe(true);
  });

  it("preserves a typed body-free worker rejection", async () => {
    const worker = new FakeWorker();
    const pending = serviceWith(worker).write({
      outputPath: "/tmp/support.json",
      content: validContent()
    });
    worker.emit("message", {
      protocolVersion: DIAGNOSTICS_EXPORT_PROTOCOL_VERSION,
      requestId: worker.request?.requestId,
      kind: "failure",
      code: "diagnostics.export_blocked"
    });

    await expect(pending).rejects.toMatchObject({ code: "diagnostics.export_blocked" });
    expect(worker.terminated).toBe(true);
  });

  it("adopts an exact committed file when cancellation wins after publication", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-export-reconcile-"));
    const outputPath = path.join(root, "support.json");
    const content = validContent();
    const worker = new FakeWorker();
    const controller = new AbortController();
    try {
      const pending = serviceWith(worker).write({ outputPath, content }, { signal: controller.signal });
      fs.writeFileSync(outputPath, content, { encoding: "utf8", mode: 0o600 });
      controller.abort();

      await expect(pending).resolves.toEqual({ bytesWritten: Buffer.byteLength(content) });
      expect(worker.terminated).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
