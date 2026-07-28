import { generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PADDLE_OCR_ENGINE_ID } from "@pige/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeOcrResult } from "../../apps/desktop/src/main/services/ocr-types";
import type { NativeImageOcrAdapterPort } from "../../apps/desktop/src/main/services/ocr-service";
import type {
  PaddleOcrProcessRequest,
  PaddleOcrProcessResult,
  PaddleOcrProcessRunner
} from "../../apps/desktop/src/main/services/paddle-ocr-adapter";
import {
  createPaddleOcrRuntimeComposition
} from "../../apps/desktop/src/main/services/paddle-ocr-runtime-composition";
import {
  canonicalPaddleOcrArtifactIdentity,
  type ReviewedPaddleOcrAvailableBundle
} from "../../apps/desktop/src/main/services/paddle-ocr-bundle-materializer";
import { createFakeLocalToolFixture } from "./helpers/local-tool-fixture";

const tempRoots: string[] = [];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64"
);

afterEach(() => {
  for (const root of tempRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("PaddleOCR runtime composition", () => {
  it("exposes the reviewed production bundle while preserving native-first OCR", async () => {
    const native = new RecordingNativeAdapter(true);
    const composition = createPaddleOcrRuntimeComposition({
      appDataRoot: tempRoot("paddle-unavailable"),
      manifestPath: path.resolve("resources/parser-manifests/paddleocr-local.parser.manifest.json"),
      assertAppInstanceWriterLease: vi.fn(),
      nativeAdapter: native,
      platform: "darwin",
      architecture: "arm64"
    });

    expect(composition.lifecycle.summary({ apiVersion: 1 })).toMatchObject({
      engineId: PADDLE_OCR_ENGINE_ID,
      state: "not_installed",
      canInstall: true,
      nativeOcrPreferred: true,
      hiddenDownloadsAllowed: false
    });
    expect(composition.recoverStaging()).toMatchObject({
      recoveredEntries: 0,
      job: { class: "tool_install", state: "completed" }
    });
    await expect(composition.adapter.recognize("/private/native.png", ["en"]))
      .resolves.toEqual(NATIVE_RESULT);
    expect(native.calls).toBe(1);
  });

  it("composes reviewed lifecycle, durable recovery, offline self-test, lease bridge, and fallback routing", async () => {
    const root = tempRoot("paddle-complete");
    const appDataRoot = path.join(root, "app-data");
    const candidate = createFakeLocalToolFixture(path.join(root, "candidate"), {
      toolId: PADDLE_OCR_ENGINE_ID,
      version: "3.7.0",
      platform: "macos",
      architecture: "arm64",
      capabilities: ["ocr.image"],
      license: { spdxId: "LicenseRef-Pige-PaddleOCR-3.7.0-Aggregate-Legal-Inventory", name: "See bundled legal inventory" },
      files: {
        "python/bin/python3": "python-runtime",
        "pige/paddle_ocr_wrapper.py": "offline-wrapper",
        "models/PP-OCRv5_mobile_det_infer/model.pdmodel": "detector",
        "models/PP-OCRv5_mobile_rec_infer/model.pdmodel": "recognizer"
      }
    });
    const manifestPath = path.join(root, "paddleocr-local.parser.manifest.json");
    writeAvailableManifest(manifestPath, candidate.packageSha256, candidate.sizeBytes);
    const runner = new RecordingPaddleRunner();
    const assertWriterLease = vi.fn();
    const materializer = {
      materialize: vi.fn(async () => ({
        version: "3.7.0",
        candidatePath: candidate.rootPath,
        expectedSha256: candidate.packageSha256
      })),
      discard: vi.fn()
    };
    const native = new RecordingNativeAdapter(false);
    const composition = createPaddleOcrRuntimeComposition({
      appDataRoot,
      manifestPath,
      assertAppInstanceWriterLease: assertWriterLease,
      bundleMaterializer: materializer,
      nativeAdapter: native,
      processRunner: runner,
      platform: "darwin",
      architecture: "arm64",
      now: () => new Date("2026-07-28T12:00:00.000Z")
    });

    const recovery = composition.recoverStaging();
    expect(recovery).toMatchObject({ recoveredEntries: 0, job: { state: "completed" } });
    const before = composition.lifecycle.summary({ apiVersion: 1 });
    expect(before).toMatchObject({ state: "not_installed", canInstall: true });

    const install = await composition.lifecycle.install({
      apiVersion: 1,
      requestId: "paddleocr_install_abcdefghijkl",
      expectedRevision: before.revision
    });
    expect(install).toMatchObject({ status: "accepted", summary: { state: "ready" } });
    expect(materializer.materialize).toHaveBeenCalledOnce();
    expect(materializer.discard).toHaveBeenCalledWith("paddleocr_install_abcdefghijkl");
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]).toMatchObject({
      networkAllowed: false,
      shell: false,
      timeoutMs: 60_000
    });
    expect(runner.calls[0]!.args.slice(0, 2)).toEqual(["-I", "-B"]);
    expect(runner.calls[0]!.args[2]).toMatch(/pige\/paddle_ocr_wrapper\.py$/u);
    expect(runner.calls[0]!.executablePath).toMatch(/python\/bin\/python3$/u);
    expect(runner.calls[0]!.env).toMatchObject({
      PIGE_NETWORK_DISABLED: "1",
      HF_HUB_OFFLINE: "1",
      TRANSFORMERS_OFFLINE: "1"
    });
    expect(runner.inputFileBytes[0]).toBeGreaterThan(5_000);

    const imagePath = path.join(root, "input.png");
    fs.writeFileSync(imagePath, PNG);
    await expect(composition.adapter.recognize(imagePath, ["en-US"]))
      .resolves.toMatchObject({ adapterId: PADDLE_OCR_ENGINE_ID, engine: "Paddle", engineVersion: "3.7.0" });
    expect(native.calls).toBe(0);
    expect(runner.calls).toHaveLength(2);
    expect(assertWriterLease).toHaveBeenCalled();

    const jobFiles = fs.readdirSync(path.join(appDataRoot, "jobs", "machine-local", "local-tools"));
    expect(jobFiles.filter((name) => name.endsWith(".json"))).toHaveLength(2);
  });

  it("rejects a materializer candidate that differs from the reviewed package identity", async () => {
    const root = tempRoot("paddle-mismatch");
    const candidate = createFakeLocalToolFixture(path.join(root, "candidate"), {
      toolId: PADDLE_OCR_ENGINE_ID,
      version: "3.7.0",
      platform: "macos",
      architecture: "arm64",
      capabilities: ["ocr.image"],
      license: { spdxId: "LicenseRef-Pige-PaddleOCR-3.7.0-Aggregate-Legal-Inventory", name: "See bundled legal inventory" }
    });
    const manifestPath = path.join(root, "paddleocr-local.parser.manifest.json");
    writeAvailableManifest(manifestPath, candidate.packageSha256, candidate.sizeBytes);
    const materializer = {
      materialize: vi.fn(async () => ({
        version: "3.7.0",
        candidatePath: candidate.rootPath,
        expectedSha256: `sha256:${"f".repeat(64)}`
      })),
      discard: vi.fn()
    };
    const composition = createPaddleOcrRuntimeComposition({
      appDataRoot: path.join(root, "app-data"),
      manifestPath,
      assertAppInstanceWriterLease: vi.fn(),
      bundleMaterializer: materializer,
      nativeAdapter: new RecordingNativeAdapter(false),
      processRunner: new RecordingPaddleRunner(),
      platform: "darwin",
      architecture: "arm64"
    });
    const before = composition.lifecycle.summary({ apiVersion: 1 });

    await expect(composition.lifecycle.install({
      apiVersion: 1,
      requestId: "paddleocr_install_mismatch",
      expectedRevision: before.revision
    })).resolves.toEqual({
      apiVersion: 1,
      requestId: "paddleocr_install_mismatch",
      engineId: PADDLE_OCR_ENGINE_ID,
      status: "failed"
    });
    expect(materializer.discard).toHaveBeenCalledOnce();
  });

  it("constructs the production materializer only from a matching reviewed signing key", () => {
    const root = tempRoot("paddle-production-materializer");
    const manifestPath = path.join(root, "paddleocr-local.parser.manifest.json");
    writeAvailableManifest(manifestPath, `sha256:${"d".repeat(64)}`, 900_000_000);
    addReviewedSigningKey(manifestPath);

    const composition = createPaddleOcrRuntimeComposition({
      appDataRoot: path.join(root, "app-data"),
      manifestPath,
      assertAppInstanceWriterLease: vi.fn(),
      nativeAdapter: new RecordingNativeAdapter(false),
      platform: "darwin",
      architecture: "arm64"
    });

    expect(composition.lifecycle.summary({ apiVersion: 1 })).toMatchObject({
      state: "not_installed",
      canInstall: true
    });
  });

  it("keeps an available bundle unsupported when its reviewed signing key is absent", () => {
    const root = tempRoot("paddle-missing-key");
    const manifestPath = path.join(root, "paddleocr-local.parser.manifest.json");
    writeAvailableManifest(manifestPath, `sha256:${"e".repeat(64)}`, 900_000_000);

    const composition = createPaddleOcrRuntimeComposition({
      appDataRoot: path.join(root, "app-data"),
      manifestPath,
      assertAppInstanceWriterLease: vi.fn(),
      nativeAdapter: new RecordingNativeAdapter(false),
      platform: "darwin",
      architecture: "arm64"
    });

    expect(composition.lifecycle.summary({ apiVersion: 1 })).toMatchObject({
      state: "unsupported",
      canInstall: false
    });
  });

  it("uses the fixed regular Windows executable instead of a link alias", async () => {
    const root = tempRoot("paddle-windows-runtime");
    const candidate = createFakeLocalToolFixture(path.join(root, "candidate"), {
      toolId: PADDLE_OCR_ENGINE_ID,
      version: "3.7.0",
      platform: "windows",
      architecture: "x64",
      capabilities: ["ocr.image"],
      license: { spdxId: "LicenseRef-Pige-PaddleOCR-3.7.0-Aggregate-Legal-Inventory", name: "See bundled legal inventory" },
      files: {
        "python/python.exe": "python-runtime",
        "pige/paddle_ocr_wrapper.py": "offline-wrapper"
      }
    });
    const manifestPath = path.join(root, "paddleocr-local.parser.manifest.json");
    writeAvailableManifest(manifestPath, candidate.packageSha256, candidate.sizeBytes, "windows-x64");
    const runner = new RecordingPaddleRunner();
    const composition = createPaddleOcrRuntimeComposition({
      appDataRoot: path.join(root, "app-data"),
      manifestPath,
      assertAppInstanceWriterLease: vi.fn(),
      bundleMaterializer: {
        materialize: async () => ({
          version: "3.7.0",
          candidatePath: candidate.rootPath,
          expectedSha256: candidate.packageSha256
        }),
        discard: vi.fn()
      },
      nativeAdapter: new RecordingNativeAdapter(false),
      processRunner: runner,
      platform: "win32",
      architecture: "x64"
    });
    const before = composition.lifecycle.summary({ apiVersion: 1 });

    await composition.lifecycle.install({
      apiVersion: 1,
      requestId: "paddleocr_install_windows",
      expectedRevision: before.revision
    });

    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]!.executablePath).toMatch(/python\/python\.exe$/u);
  });
});

class RecordingNativeAdapter implements NativeImageOcrAdapterPort {
  calls = 0;

  constructor(readonly available: boolean) {}

  isAvailable(): boolean {
    return this.available;
  }

  async recognize(): Promise<NativeOcrResult> {
    this.calls += 1;
    return NATIVE_RESULT;
  }
}

class RecordingPaddleRunner implements PaddleOcrProcessRunner {
  readonly calls: PaddleOcrProcessRequest[] = [];
  readonly inputFileBytes: number[] = [];

  async run(request: PaddleOcrProcessRequest): Promise<PaddleOcrProcessResult> {
    this.calls.push(request);
    const input = JSON.parse(request.stdin) as { requestId: string; inputPath: string };
    this.inputFileBytes.push(fs.statSync(input.inputPath).size);
    return {
      stdout: JSON.stringify({
        schemaVersion: 1,
        requestId: input.requestId,
        ok: true,
        result: {
          adapterId: PADDLE_OCR_ENGINE_ID,
          adapterVersion: "1.0.0",
          engine: "Paddle",
          engineVersion: "3.7.0",
          text: "",
          blocks: [],
          languageHints: ["en"],
          warnings: [],
          image: {
            typeIdentifier: "public.png",
            frameCount: 1,
            sourceWidth: 1,
            sourceHeight: 1,
            decodedWidth: 1,
            decodedHeight: 1,
            downsampled: false
          }
        }
      })
    };
  }
}

const NATIVE_RESULT: NativeOcrResult = {
  adapterId: "macos_vision_ocr",
  adapterVersion: "1.0.0",
  engine: "macos_vision_text",
  engineVersion: "1",
  text: "native",
  blocks: [],
  languageHints: ["en"],
  warnings: [],
  image: {
    typeIdentifier: "public.png",
    frameCount: 1,
    sourceWidth: 1,
    sourceHeight: 1,
    decodedWidth: 1,
    decodedHeight: 1,
    downsampled: false
  }
};

function writeAvailableManifest(
  manifestPath: string,
  packageSha256: string,
  installedSizeBytes: number,
  platform: "macos-arm64" | "windows-x64" = "macos-arm64"
): void {
  const manifest = JSON.parse(fs.readFileSync(
    path.resolve("resources/parser-manifests/paddleocr-local.parser.manifest.json"),
    "utf8"
  )) as { releaseBundles: Record<string, unknown>[] };
  const bundleIndex = platform === "macos-arm64" ? 0 : 1;
  manifest.releaseBundles[bundleIndex] = {
    platform,
    state: "available",
    artifactUrl: `https://github.com/pige/paddleocr/releases/download/test/paddleocr-${platform}.zip`,
    sizeBytes: installedSizeBytes + 1024,
    sha256: "a".repeat(64),
    signature: {
      algorithm: "Ed25519",
      keyId: "pige-release-test-key",
      valueBase64: Buffer.alloc(64, 1).toString("base64")
    },
    sbomSha256: "b".repeat(64),
    installedTreeSha256: packageSha256.slice("sha256:".length),
    installedSizeBytes,
    wrapperSha256: "c".repeat(64),
    packageLimits: {
      maxManifestBytes: 8 * 1024 * 1024,
      maxFileBytes: 1024 * 1024 * 1024,
      maxTotalBytes: 1024 * 1024 * 1024,
      maxFiles: 20_000
    }
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function addReviewedSigningKey(manifestPath: string): void {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    engineVersion: string;
    releaseBundles: ReviewedPaddleOcrAvailableBundle[];
    releaseSigningKeys?: Record<string, unknown>[];
  };
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const bundle = manifest.releaseBundles[0]!;
  const keyId = "pige-paddleocr-test-key";
  const unsigned = {
    ...bundle,
    signature: { ...bundle.signature, keyId, valueBase64: Buffer.alloc(64).toString("base64") }
  };
  const valueBase64 = sign(
    null,
    Buffer.from(canonicalPaddleOcrArtifactIdentity(unsigned, manifest.engineVersion), "utf8"),
    privateKey
  ).toString("base64");
  manifest.releaseBundles[0] = { ...unsigned, signature: { ...unsigned.signature, valueBase64 } };
  manifest.releaseSigningKeys = [{
    algorithm: "Ed25519",
    keyId,
    publicKeySpkiBase64: publicKey.export({ format: "der", type: "spki" }).toString("base64")
  }];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

function tempRoot(label: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pige-${label}-`));
  tempRoots.push(root);
  return root;
}
