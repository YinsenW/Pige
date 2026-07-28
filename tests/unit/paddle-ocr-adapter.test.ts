import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PigeDomainError } from "@pige/domain";
import {
  PaddleOcrAdapter,
  type PaddleOcrProcessRequest,
  type PaddleOcrProcessResult,
  type PaddleOcrProcessRunner,
  type PaddleOcrRuntimeLease,
  type PaddleOcrRuntimeLeasePort
} from "../../apps/desktop/src/main/services/paddle-ocr-adapter";
import { OCR_HELPER_MAX_OUTPUT_BYTES, OCR_MAX_FILE_BYTES } from "../../apps/desktop/src/main/services/ocr-types";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PaddleOcrAdapter", () => {
  it("runs the fixed isolated wrapper once and returns a strict Paddle result", async () => {
    const fixture = createFixture();
    const runner = new RecordingRunner(({ stdin }) => ({ stdout: successResponse(stdin) }));
    const adapter = new PaddleOcrAdapter(fixture.leases, runner);

    const result = await adapter.recognize(fixture.inputPath, ["en_US", "ko-KR", "invalid hint"]);

    expect(result).toMatchObject({
      adapterId: "paddleocr_local",
      adapterVersion: "1.0.0",
      engine: "Paddle",
      engineVersion: "3.7.0",
      text: "Verified local text."
    });
    expect(fixture.leases.acquireCalls).toBe(1);
    expect(fixture.lease.assertCurrentCalls).toBe(2);
    expect(fixture.lease.releaseCalls).toBe(1);
    expect(runner.calls).toHaveLength(1);
    const call = runner.calls[0]!;
    expect(call.executablePath).toBe(fs.realpathSync(fixture.pythonPath));
    expect(call.args).toEqual(["-I", "-B", fs.realpathSync(fixture.wrapperPath)]);
    expect(call.cwd).toBe(fs.realpathSync(fixture.runtimeRoot));
    expect(call.shell).toBe(false);
    expect(call.networkAllowed).toBe(false);
    expect(call.env).toMatchObject({
      PIGE_NETWORK_DISABLED: "1",
      PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: "True",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1"
    });
    expect(call.env).not.toHaveProperty("PATH");
    expect(call.env).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(JSON.parse(call.stdin)).toMatchObject({
      operation: "recognize",
      inputPath: fs.realpathSync(fixture.inputPath),
      preferredLanguages: ["en-US", "ko-KR"],
      networkAllowed: false
    });
  });

  it("rejects malformed and oversized helper output without projecting private output", async () => {
    const malformed = createFixture();
    const malformedAdapter = new PaddleOcrAdapter(
      malformed.leases,
      new RecordingRunner(() => ({ stdout: JSON.stringify({ privatePath: "/secret/input.png" }) }))
    );
    await expect(malformedAdapter.recognize(malformed.inputPath, [])).rejects.toMatchObject({
      code: "ocr.helper_invalid_response",
      message: "The local OCR helper returned an invalid recognition response."
    });

    const oversized = createFixture();
    const oversizedAdapter = new PaddleOcrAdapter(
      oversized.leases,
      new RecordingRunner(() => ({ stdout: "x".repeat(OCR_HELPER_MAX_OUTPUT_BYTES + 1) }))
    );
    await expect(oversizedAdapter.recognize(oversized.inputPath, [])).rejects.toMatchObject({
      code: "ocr.helper_output_too_large"
    });
  });

  it("rejects oversized input before acquiring a runtime lease", async () => {
    const fixture = createFixture();
    fs.truncateSync(fixture.inputPath, OCR_MAX_FILE_BYTES + 1);
    const runner = new RecordingRunner(({ stdin }) => ({ stdout: successResponse(stdin) }));
    const adapter = new PaddleOcrAdapter(fixture.leases, runner);

    await expect(adapter.recognize(fixture.inputPath, [])).rejects.toMatchObject({ code: "ocr.input_too_large" });
    expect(fixture.leases.acquireCalls).toBe(0);
    expect(runner.calls).toHaveLength(0);
  });

  it.each([
    ["timeout", new PigeDomainError("ocr.helper_timeout", "private timeout detail"), "ocr.helper_timeout"],
    ["process failure", new Error("/private/runtime/python failed"), "ocr.helper_failed"]
  ])("fails closed on %s and releases the lease", async (_label, failure, expectedCode) => {
    const fixture = createFixture();
    const adapter = new PaddleOcrAdapter(
      fixture.leases,
      new RecordingRunner(() => Promise.reject(failure))
    );

    const error = await adapter.recognize(fixture.inputPath, []).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: expectedCode });
    expect(String((error as Error).message)).not.toContain("private");
    expect(fixture.leases.acquireCalls).toBe(1);
    expect(fixture.lease.releaseCalls).toBe(1);
  });

  it("rejects mismatched identity and dimensions beyond the helper contract", async () => {
    const fixture = createFixture();
    const adapter = new PaddleOcrAdapter(
      fixture.leases,
      new RecordingRunner(({ stdin }) => {
        const response = JSON.parse(successResponse(stdin)) as { result: { image: { sourceWidth: number } } };
        response.result.image.sourceWidth = 20_001;
        return { stdout: JSON.stringify(response) };
      })
    );

    await expect(adapter.recognize(fixture.inputPath, [])).rejects.toMatchObject({
      code: "ocr.helper_invalid_response"
    });
  });
});

class RecordingRunner implements PaddleOcrProcessRunner {
  readonly calls: PaddleOcrProcessRequest[] = [];

  constructor(
    private readonly execute: (
      request: PaddleOcrProcessRequest
    ) => PaddleOcrProcessResult | Promise<PaddleOcrProcessResult>
  ) {}

  run(request: PaddleOcrProcessRequest): Promise<PaddleOcrProcessResult> {
    this.calls.push(request);
    return Promise.resolve(this.execute(request));
  }
}

class FakeLease implements PaddleOcrRuntimeLease {
  assertCurrentCalls = 0;
  releaseCalls = 0;

  constructor(
    readonly runtimeRoot: string,
    readonly pythonExecutablePath: string,
    readonly engineVersion = "3.7.0"
  ) {}

  assertCurrent(): void {
    this.assertCurrentCalls += 1;
  }

  release(): void {
    this.releaseCalls += 1;
  }
}

class FakeLeasePort implements PaddleOcrRuntimeLeasePort {
  acquireCalls = 0;

  constructor(readonly lease: PaddleOcrRuntimeLease) {}

  isAvailable(): boolean {
    return true;
  }

  async acquire(): Promise<PaddleOcrRuntimeLease> {
    this.acquireCalls += 1;
    return this.lease;
  }
}

function createFixture(): {
  readonly runtimeRoot: string;
  readonly pythonPath: string;
  readonly wrapperPath: string;
  readonly inputPath: string;
  readonly lease: FakeLease;
  readonly leases: FakeLeasePort;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pige-paddle-adapter-"));
  tempRoots.push(root);
  const runtimeRoot = path.join(root, "runtime");
  const wrapperPath = path.join(runtimeRoot, "pige", "paddle_ocr_wrapper.py");
  const pythonPath = path.join(runtimeRoot, "python", "python3");
  const inputPath = path.join(root, "input.png");
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.mkdirSync(path.dirname(pythonPath), { recursive: true });
  fs.writeFileSync(wrapperPath, "# verified wrapper\n", "utf8");
  fs.writeFileSync(pythonPath, "verified python\n", "utf8");
  fs.writeFileSync(inputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const lease = new FakeLease(runtimeRoot, pythonPath);
  return { runtimeRoot, pythonPath, wrapperPath, inputPath, lease, leases: new FakeLeasePort(lease) };
}

function successResponse(stdin: string): string {
  const request = JSON.parse(stdin) as { requestId: string };
  return JSON.stringify({
    schemaVersion: 1,
    requestId: request.requestId,
    ok: true,
    result: {
      adapterId: "paddleocr_local",
      adapterVersion: "1.0.0",
      engine: "Paddle",
      engineVersion: "3.7.0",
      text: "Verified local text.",
      blocks: [{
        text: "Verified local text.",
        kind: "line",
        confidence: 0.98,
        boundingBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.1 },
        languageHints: ["en"],
        isTitle: false
      }],
      languageHints: ["en"],
      confidence: 0.98,
      warnings: [],
      image: {
        typeIdentifier: "public.png",
        frameCount: 1,
        sourceWidth: 800,
        sourceHeight: 600,
        decodedWidth: 800,
        decodedHeight: 600,
        downsampled: false
      }
    }
  });
}
