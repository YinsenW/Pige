import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  JsonOcrHelperRunner,
  type OcrHelperRequest
} from "../../apps/desktop/src/main/services/macos-vision-ocr-adapter";
import type { MacOSVisionOcrHelperDescriptor } from "../../apps/desktop/src/main/services/ocr-types";
import { JobCancellationError } from "../../apps/desktop/src/main/services/job-execution-control";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("macOS Vision OCR helper runner", () => {
  it("rejects helpers that exceed the execution deadline", async () => {
    const helper = makeHelper("setTimeout(() => {}, 10_000);\n");

    await expect(new JsonOcrHelperRunner(25, 1024).run(helper, request())).rejects.toMatchObject({
      code: "ocr.helper_timeout"
    });
  });

  it("rejects oversized or invalid helper output without retaining it", async () => {
    const oversized = makeHelper('process.stdout.write("x".repeat(4096));\n');
    await expect(new JsonOcrHelperRunner(1_000, 128).run(oversized, request())).rejects.toMatchObject({
      code: "ocr.helper_output_too_large"
    });

    const invalid = makeHelper('process.stdout.write("not-json");\n');
    await expect(new JsonOcrHelperRunner(1_000, 1024).run(invalid, request())).rejects.toMatchObject({
      code: "ocr.helper_invalid_response"
    });
  });

  it("maps non-zero exits and launch failures to stable local errors", async () => {
    const failed = makeHelper("process.exit(7);\n");
    await expect(new JsonOcrHelperRunner(1_000, 1024).run(failed, request())).rejects.toMatchObject({
      code: "ocr.helper_failed"
    });

    await expect(new JsonOcrHelperRunner(1_000, 1024).run({
      ...failed,
      binaryPath: path.join(path.dirname(failed.binaryPath), "missing-helper")
    }, request())).rejects.toMatchObject({ code: "ocr.helper_launch_failed" });
  });

  it("rejects protocol requests beyond the bounded stdin envelope", async () => {
    const helper = makeHelper("setTimeout(() => {}, 10_000);\n");
    const oversizedRequest: OcrHelperRequest = {
      ...request(),
      inputPath: `/${"a".repeat(70 * 1024)}`
    };

    await expect(new JsonOcrHelperRunner(1_000, 1024).run(helper, oversizedRequest)).rejects.toMatchObject({
      code: "ocr.helper_request_too_large"
    });
  });

  it("kills the local helper when cooperative job cancellation is requested", async () => {
    const helper = makeHelper("setTimeout(() => {}, 10_000);\n");
    const controller = new AbortController();
    const running = new JsonOcrHelperRunner(10_000, 1024).run(helper, request(), controller.signal);

    controller.abort();

    await expect(running).rejects.toBeInstanceOf(JobCancellationError);
  });
});

function request(): OcrHelperRequest {
  return {
    schemaVersion: 1,
    requestId: "ocr_runner_test",
    operation: "probe"
  };
}

function makeHelper(source: string): MacOSVisionOcrHelperDescriptor {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-ocr-runner-test-"));
  tempRoots.push(root);
  const binaryPath = path.join(root, "helper");
  fs.writeFileSync(binaryPath, `#!${process.execPath}\n${source}`, { encoding: "utf8", mode: 0o755 });
  return {
    binaryPath,
    binaryChecksum: `sha256:${"a".repeat(64)}`,
    helperVersion: "1.0.0",
    protocolVersion: 1
  };
}
