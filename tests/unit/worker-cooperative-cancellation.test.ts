import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";
import { LocalDatabaseRebuildWorkerService } from "../../apps/desktop/src/main/services/local-database-rebuild-worker-service";
import { OfficeMediaMaterializerWorkerAdapter } from "../../apps/desktop/src/main/services/office-media-materializer-service";
import { OfficeParserWorkerAdapter } from "../../apps/desktop/src/main/services/office-parser-service";
import { PdfParserWorkerAdapter } from "../../apps/desktop/src/main/services/pdf-parser-service";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("worker cooperative cancellation", () => {
  it("terminates parser, PPTX media, and local-index workers through the shared abort signal", async () => {
    const workerUrl = makeHangingWorker();
    const resolveModule = (moduleId: string): string => `/resolved/${moduleId}`;
    const pdf = new PdfParserWorkerAdapter(workerUrl, 10_000, resolveModule);
    const office = new OfficeParserWorkerAdapter(workerUrl, 10_000, resolveModule);
    const media = new OfficeMediaMaterializerWorkerAdapter(workerUrl, 10_000, resolveModule);
    const index = new LocalDatabaseRebuildWorkerService({ workerUrl, timeoutMs: 10_000 });

    await expectCancelled((signal) => pdf.extract("/tmp/cancel.pdf", signal));
    await expectCancelled((signal) => office.extract("/tmp/cancel.docx", "docx_file", signal));
    await expectCancelled((signal) => media.materialize("/tmp/cancel.pptx", [], signal));
    await expectCancelled((signal) => index.rebuild(path.join(os.tmpdir(), "pige-index-cancel"), { signal }));
  });
});

async function expectCancelled(start: (signal: AbortSignal) => Promise<unknown>): Promise<void> {
  const controller = new AbortController();
  const running = start(controller.signal);
  controller.abort();
  await expect(running).rejects.toBeInstanceOf(JobCancellationError);
}

function makeHangingWorker(): URL {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-worker-cancel-test-"));
  tempRoots.push(root);
  const workerPath = path.join(root, "hanging-worker.mjs");
  fs.writeFileSync(
    workerPath,
    'import { parentPort } from "node:worker_threads";\nparentPort?.on("message", () => undefined);\n',
    "utf8"
  );
  return pathToFileURL(workerPath);
}
