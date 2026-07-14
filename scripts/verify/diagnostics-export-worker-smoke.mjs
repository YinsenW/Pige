import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const root = process.cwd();
const builtAppRoot = process.env.PIGE_BUILT_APP_ROOT
  ? path.resolve(process.env.PIGE_BUILT_APP_ROOT)
  : path.join(root, "apps/desktop");
const workerPath = path.join(builtAppRoot, "out/main/workers/diagnostics-export-worker.js");
if (!fs.existsSync(workerPath)) {
  throw new Error("Built diagnostics export worker is missing.");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-diagnostics-worker-smoke-"));
try {
  const content = createSafeBundle();
  const outputPath = path.join(tempRoot, "support.json");
  const successPrepared = prepareOutput(outputPath, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  const success = await runWorker({
    protocolVersion: 1,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    outputPath,
    content,
    prepared: successPrepared.request
  }, successPrepared);
  if (
    success.kind !== "success" ||
    success.bytesWritten !== Buffer.byteLength(content) ||
    fs.readFileSync(outputPath, "utf8") !== content ||
    (process.platform !== "win32" && (fs.statSync(outputPath).mode & 0o777) !== 0o600)
  ) {
    throw new Error("Built diagnostics export worker did not publish the exact bounded bundle.");
  }

  const blockedPath = path.join(tempRoot, "blocked.json");
  const blockedPrepared = prepareOutput(blockedPath, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  const blocked = await runWorker({
    protocolVersion: 1,
    requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    outputPath: blockedPath,
    content: content.replace(
      '"recentEvents":[]',
      '"recentEvents": [{"recordedAt":"2026-07-15T00:00:00.000Z","level":"error","code":"diagnostics.safe","message":"[REDACTED_CONTENT]","payload":"private body"}]'
    ),
    prepared: blockedPrepared.request
  }, blockedPrepared);
  if (blocked.kind !== "failure" || blocked.code !== "diagnostics.export_blocked" ||
    fs.existsSync(blockedPath)) {
    throw new Error("Built diagnostics export worker did not fail closed for an opaque nested body.");
  }

  console.log("Built diagnostics export worker published one exact local bundle and blocked one unsafe bundle.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function runWorker(request, prepared) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const worker = new Worker(pathToFileURL(workerPath), {
      name: "pige-diagnostics-export-worker-smoke",
      resourceLimits: { maxOldGenerationSizeMb: 64 }
    });
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void worker.terminate().then(() => {
        releaseOutput(prepared);
        callback();
      }, (error) => {
        releaseOutput(prepared);
        reject(error);
      });
    };
    const timeout = setTimeout(() => finish(() => {
      reject(new Error("Built diagnostics export worker smoke timed out."));
    }), 30_000);
    worker.once("message", (response) => {
      finish(() => resolve(response));
    });
    worker.once("error", (error) => {
      finish(() => reject(error));
    });
    worker.once("exit", (code) => {
      if (!settled && code !== 0) {
        finish(() => reject(new Error(`Built diagnostics export worker exited with status ${String(code)}.`)));
      }
    });
    worker.postMessage(request);
  });
}

function prepareOutput(outputPath, generation) {
  const parentRealPath = fs.realpathSync(path.dirname(outputPath));
  const parent = fs.statSync(parentRealPath);
  const destination = path.join(parentRealPath, path.basename(outputPath));
  const temporaryPath = path.join(parentRealPath, `.pige-support-${generation}.tmp`);
  const temporaryDescriptor = fs.openSync(temporaryPath, "wx", 0o600);
  const temporary = fs.fstatSync(temporaryDescriptor);
  return {
    temporaryDescriptor,
    temporaryPath,
    request: {
      outputPath,
      destination,
      parentRealPath,
      parentDevice: parent.dev,
      parentInode: parent.ino,
      temporaryPath,
      temporaryDescriptor,
      temporaryDevice: temporary.dev,
      temporaryInode: temporary.ino
    }
  };
}

function releaseOutput(prepared) {
  try {
    fs.rmSync(prepared.temporaryPath, { force: true });
  } finally {
    fs.closeSync(prepared.temporaryDescriptor);
  }
}

function createSafeBundle() {
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
