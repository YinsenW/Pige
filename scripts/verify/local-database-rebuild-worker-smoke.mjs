import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const root = process.cwd();
const builtAppRoot = process.env.PIGE_BUILT_APP_ROOT
  ? path.resolve(process.env.PIGE_BUILT_APP_ROOT)
  : path.join(root, "apps/desktop");
const workerPath = path.join(builtAppRoot, "out/main/workers/local-database-rebuild-worker.js");
if (!fs.existsSync(workerPath)) {
  console.error(`Missing built index worker: ${path.relative(root, workerPath)}. Run npm run build first.`);
  process.exit(1);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pige-index-worker-smoke-"));
try {
  const vaultPath = path.join(tempRoot, "Vault");
  const pagePath = path.join(vaultPath, "wiki", "worker-index.md");
  fs.mkdirSync(path.dirname(pagePath), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, ".pige", "db"), { recursive: true });
  fs.writeFileSync(pagePath, `---
id: "page_20260711_workerindex"
schema_version: 1
title: "Worker Index"
type: "note"
created_at: "2026-07-11T00:00:00.000Z"
updated_at: "2026-07-11T00:00:00.000Z"
status: "active"
language: "en"
source_ids: []
---

The local database rebuild worker keeps the Electron main thread responsive.
`, "utf8");

  const request = {
    protocolVersion: 1,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    vaultPath
  };
  const worker = new Worker(pathToFileURL(workerPath), {
    name: "pige-index-worker-smoke",
    resourceLimits: { maxOldGenerationSizeMb: 512 }
  });
  try {
    const responses = await collectResponses(worker, request);
    const progress = responses.filter((message) => message?.kind === "progress");
    const result = responses.find((message) => message?.kind === "success")?.result;
    if (
      !result ||
      result.pageCount !== 1 ||
      result.invalidPageCount !== 0 ||
      progress.length < 2 ||
      progress[0]?.progress?.completedUnits !== 0 ||
      progress.at(-1)?.progress?.completedUnits !== progress.at(-1)?.progress?.totalUnits
    ) {
      throw new Error("Index rebuild worker returned an invalid progress or result envelope.");
    }
  } finally {
    await worker.terminate();
  }

  const database = new DatabaseSync(path.join(vaultPath, ".pige", "db", "vault.sqlite"), {
    readOnly: true,
    allowExtension: false
  });
  try {
    const row = database.prepare("SELECT page_id, title FROM pages").get();
    const chunk = database.prepare(
      "SELECT owner_id, chunker_version, character_start, character_end FROM chunks"
    ).get();
    if (
      row?.page_id !== "page_20260711_workerindex" ||
      row?.title !== "Worker Index" ||
      chunk?.owner_id !== "page_20260711_workerindex" ||
      chunk?.chunker_version !== "pige-markdown-v1" ||
      Number(chunk?.character_start) !== 0 ||
      Number(chunk?.character_end) <= 0
    ) {
      throw new Error("Built index worker did not publish the expected rebuildable page metadata.");
    }
  } finally {
    database.close();
  }

  console.log("Built local database rebuild worker reported progress and published page plus chunk metadata.");
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

function collectResponses(worker, request) {
  return new Promise((resolve, reject) => {
    const responses = [];
    const timeout = setTimeout(() => reject(new Error("Index rebuild worker smoke timed out.")), 30_000);
    worker.on("message", (message) => {
      if (!message || message.requestId !== request.requestId || message.protocolVersion !== 1) {
        clearTimeout(timeout);
        reject(new Error("Index rebuild worker returned an invalid response envelope."));
        return;
      }
      responses.push(message);
      if (message.kind === "success") {
        clearTimeout(timeout);
        resolve(responses);
      } else if (message.kind === "failure") {
        clearTimeout(timeout);
        reject(new Error(`Index rebuild worker failed: ${message.error?.code ?? "unknown"}`));
      }
    });
    worker.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`Index rebuild worker exited before completion with code ${code}.`));
      }
    });
    worker.postMessage(request);
  });
}
