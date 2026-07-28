import { createPublicKey, randomUUID, type KeyLike } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { PADDLE_OCR_ENGINE_ID } from "@pige/schemas";
import { LocalToolJobRecorder } from "./local-tool-job-recorder";
import { LocalToolManagerService } from "./local-tool-manager-service";
import type {
  LocalToolAuthorityPort,
  LocalToolAuthorityRequest,
  LocalToolDefinition,
  LocalToolRecoveryResult,
  LocalToolSelfTestPort,
  LocalToolSelfTestRequest,
  LocalToolSelfTestResult,
  LocalToolVerifiedRuntime
} from "./local-tool-manager-types";
import { resolveLocalToolPackageLimits } from "./local-tool-package";
import { MacOSVisionOcrAdapter } from "./macos-vision-ocr-adapter";
import { NativeOcrAdapterRouter } from "./native-ocr-adapter-router";
import type { NativeImageOcrAdapterPort } from "./ocr-service";
import {
  PaddleOcrAdapter,
  SpawnPaddleOcrProcessRunner,
  type PaddleOcrProcessRunner,
  type PaddleOcrRuntimeLease,
  type PaddleOcrRuntimeLeasePort
} from "./paddle-ocr-adapter";
import {
  PaddleOcrBundleMaterializer,
  type ReviewedPaddleOcrAvailableBundle
} from "./paddle-ocr-bundle-materializer";
import {
  createUnavailablePaddleOcrLifecycleService,
  PaddleOcrLifecycleService,
  readPaddleOcrReviewedManifest,
  type PaddleOcrBundleMaterializerPort,
  type PaddleOcrLocalToolManagerPort
} from "./paddle-ocr-lifecycle-service";

const LOCAL_TOOL_USER_ORIGIN = "user";
const PADDLE_SETTINGS_ORIGIN = "settings.local_capabilities";
const SELF_TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=",
  "base64"
);

export interface PaddleOcrRuntimeCompositionOptions {
  readonly appDataRoot: string;
  readonly manifestPath: string;
  readonly assertAppInstanceWriterLease: () => void;
  readonly bundleMaterializer?: PaddleOcrBundleMaterializerPort;
  readonly nativeAdapter?: NativeImageOcrAdapterPort;
  readonly processRunner?: PaddleOcrProcessRunner;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
  readonly now?: () => Date;
}

export interface PaddleOcrRuntimeComposition {
  readonly lifecycle: PaddleOcrLifecycleService;
  readonly adapter: NativeImageOcrAdapterPort;
  recoverStaging(): LocalToolRecoveryResult | undefined;
}

export function createPaddleOcrRuntimeComposition(
  options: PaddleOcrRuntimeCompositionOptions
): PaddleOcrRuntimeComposition {
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const nativeAdapter = options.nativeAdapter ?? new MacOSVisionOcrAdapter();
  const reviewed = readPaddleOcrReviewedManifest(options.manifestPath, platform, architecture);
  const release = reviewed.releaseBundle?.state === "available" ? reviewed.releaseBundle : undefined;
  if (!release) {
    return unavailableComposition(options.manifestPath, nativeAdapter, options.processRunner, platform, architecture);
  }

  const appDataRoot = requirePrivateAppDataRoot(options.appDataRoot);
  const bundleMaterializer = options.bundleMaterializer ?? createReviewedBundleMaterializer(
    release,
    reviewed.engineVersion,
    appDataRoot,
    reviewed.releaseSigningKeys,
    reviewed.trustedReleaseOrigins
  );
  if (!bundleMaterializer) {
    return unavailableComposition(options.manifestPath, nativeAdapter, options.processRunner, platform, architecture);
  }
  const packageLimits = resolveLocalToolPackageLimits(release.packageLimits);
  const definition: LocalToolDefinition = {
    toolId: PADDLE_OCR_ENGINE_ID,
    label: "PaddleOCR local engine",
    kind: "ocr",
    version: reviewed.engineVersion,
    platform: release.platform === "macos-arm64" ? "macos" : "windows",
    architecture: release.platform === "macos-arm64" ? "arm64" : "x64",
    capabilities: ["ocr.image"],
    license: { spdxId: "NOASSERTION", name: "See bundled legal inventory" },
    expectedSha256: normalizeDigest(release.installedTreeSha256),
    expectedSizeBytes: release.installedSizeBytes,
    packageLimits
  };
  const processRunner = options.processRunner ?? new SpawnPaddleOcrProcessRunner();
  const manager = new LocalToolManagerService({
    trustedAppDataRoot: appDataRoot,
    localToolRoot: path.join(appDataRoot, "local-tools"),
    catalog: { tools: [definition] },
    authorityPort: new PaddleOcrCompositionAuthority(options.assertAppInstanceWriterLease),
    jobRecorder: new LocalToolJobRecorder({
      rootPath: path.join(appDataRoot, "jobs", "machine-local", "local-tools"),
      assertWriterLease: options.assertAppInstanceWriterLease
    }),
    selfTestPort: new PaddleOcrSelfTestPort(processRunner, reviewed.engineVersion, appDataRoot),
    selfTestTimeoutMs: 60_000,
    platform: release.platform === "macos-arm64" ? "macos" : "windows",
    architecture: release.platform === "macos-arm64" ? "arm64" : "x64",
    ...(options.now ? { now: options.now } : {})
  });
  const materializer = new ReviewedBundleMaterializer(
    bundleMaterializer,
    definition.version,
    definition.expectedSha256
  );
  const leasePort = new PaddleRuntimeLeaseBridge(manager, reviewed.engineVersion, platform);
  return {
    lifecycle: new PaddleOcrLifecycleService({
      catalog: reviewed.catalog,
      manager: new PaddleLifecycleManagerBridge(manager),
      materializer
    }),
    adapter: new NativeOcrAdapterRouter(nativeAdapter, new PaddleOcrAdapter(leasePort, processRunner)),
    recoverStaging: () => {
      options.assertAppInstanceWriterLease();
      return manager.recoverStaging({
        requestId: `paddleocr_recover_${randomUUID().replaceAll("-", "")}`,
        userOrigin: LOCAL_TOOL_USER_ORIGIN
      });
    }
  };
}

class PaddleOcrCompositionAuthority implements LocalToolAuthorityPort {
  readonly #assertWriterLease: () => void;

  constructor(assertWriterLease: () => void) {
    this.#assertWriterLease = assertWriterLease;
  }

  assertAuthorized(request: LocalToolAuthorityRequest): void {
    this.#assertWriterLease();
    const validTarget = request.toolId === PADDLE_OCR_ENGINE_ID ||
      request.action === "recover_staging" && request.toolId === "local-tool-root";
    if (
      request.userOrigin !== LOCAL_TOOL_USER_ORIGIN ||
      request.actorType !== "local_tool" ||
      request.capability !== "install_local_tool" ||
      request.resourceScope !== "current_action" ||
      !validTarget
    ) {
      throw new PigeDomainError("permission.binding_changed", "The PaddleOCR lifecycle authority binding changed.");
    }
  }
}

class PaddleLifecycleManagerBridge implements PaddleOcrLocalToolManagerPort {
  readonly #manager: LocalToolManagerService;

  constructor(manager: LocalToolManagerService) {
    this.#manager = manager;
  }

  inspect(toolId: string) {
    return this.#manager.inspect(toolId);
  }

  install(request: Parameters<PaddleOcrLocalToolManagerPort["install"]>[0]) {
    return this.#manager.install({ ...request, userOrigin: bridgeSettingsOrigin(request.userOrigin) });
  }

  setEnabled(request: Parameters<PaddleOcrLocalToolManagerPort["setEnabled"]>[0]) {
    return this.#manager.setEnabled({ ...request, userOrigin: bridgeSettingsOrigin(request.userOrigin) });
  }

  test(request: Parameters<PaddleOcrLocalToolManagerPort["test"]>[0]) {
    return this.#manager.test({ ...request, userOrigin: bridgeSettingsOrigin(request.userOrigin) });
  }

  remove(request: Parameters<PaddleOcrLocalToolManagerPort["remove"]>[0]) {
    return this.#manager.remove({ ...request, userOrigin: bridgeSettingsOrigin(request.userOrigin) });
  }
}

class ReviewedBundleMaterializer implements PaddleOcrBundleMaterializerPort {
  readonly #delegate: PaddleOcrBundleMaterializerPort;
  readonly #version: string;
  readonly #expectedSha256: string;

  constructor(delegate: PaddleOcrBundleMaterializerPort, version: string, expectedSha256: string) {
    this.#delegate = delegate;
    this.#version = version;
    this.#expectedSha256 = expectedSha256;
  }

  async materialize(requestId: string) {
    const candidate = await this.#delegate.materialize(requestId);
    if (candidate.version !== this.#version || candidate.expectedSha256 !== this.#expectedSha256) {
      await this.#delegate.discard(requestId);
      throw new PigeDomainError(
        "settings.local_tool_checksum_mismatch",
        "The materialized PaddleOCR bundle does not match the reviewed catalog."
      );
    }
    return candidate;
  }

  discard(requestId: string): void | Promise<void> {
    return this.#delegate.discard(requestId);
  }
}

class PaddleRuntimeLeaseBridge implements PaddleOcrRuntimeLeasePort {
  readonly #manager: LocalToolManagerService;
  readonly #engineVersion: string;
  readonly #platform: NodeJS.Platform;

  constructor(manager: LocalToolManagerService, engineVersion: string, platform: NodeJS.Platform) {
    this.#manager = manager;
    this.#engineVersion = engineVersion;
    this.#platform = platform;
  }

  isAvailable(): boolean {
    try {
      return this.#manager.inspect(PADDLE_OCR_ENGINE_ID).routable;
    } catch {
      return false;
    }
  }

  withVerifiedRuntime<T>(callback: (runtime: PaddleOcrRuntimeLease) => Promise<T>): Promise<T> {
    return this.#manager.withVerifiedRuntime(PADDLE_OCR_ENGINE_ID, (runtime) => callback({
      runtimeRoot: runtime.rootPath,
      pythonExecutablePath: path.join(
        runtime.rootPath,
        ...(this.#platform === "win32" ? ["python", "python.exe"] : ["python", "bin", "python3"])
      ),
      engineVersion: this.#engineVersion
    }));
  }
}

class PaddleOcrSelfTestPort implements LocalToolSelfTestPort {
  readonly #runner: PaddleOcrProcessRunner;
  readonly #engineVersion: string;
  readonly #appDataRoot: string;

  constructor(runner: PaddleOcrProcessRunner, engineVersion: string, appDataRoot: string) {
    this.#runner = runner;
    this.#engineVersion = engineVersion;
    this.#appDataRoot = appDataRoot;
  }

  async run(request: LocalToolSelfTestRequest): Promise<LocalToolSelfTestResult> {
    if (
      request.toolId !== PADDLE_OCR_ENGINE_ID ||
      request.assetId !== undefined ||
      request.version !== this.#engineVersion ||
      request.networkAllowed !== false
    ) return failedSelfTest();
    const selfTestRoot = path.join(this.#appDataRoot, "local-tools", ".self-test");
    fs.mkdirSync(selfTestRoot, { recursive: true, mode: 0o700 });
    const inputPath = path.join(selfTestRoot, `paddle-${randomUUID()}.png`);
    try {
      fs.writeFileSync(inputPath, SELF_TEST_PNG, { mode: 0o600, flag: "wx" });
      const runtime: LocalToolVerifiedRuntime = {
        toolId: PADDLE_OCR_ENGINE_ID,
        rootPath: request.stagedRootPath,
        version: request.version,
        manifestSha256: "self-test"
      };
      const platform = request.manifest.platform === "windows" ? "win32" : "darwin";
      const lease = fixedLeasePort({
        runtimeRoot: runtime.rootPath,
        pythonExecutablePath: path.join(
          runtime.rootPath,
          ...(platform === "win32" ? ["python", "python.exe"] : ["python", "bin", "python3"])
        ),
        engineVersion: this.#engineVersion
      });
      const result = await new PaddleOcrAdapter(lease, this.#runner).recognize(inputPath, ["en"]);
      return {
        schemaVersion: 1,
        passed: true,
        outputBytes: Buffer.byteLength(result.text, "utf8"),
        messageCode: "local_tool.test_passed"
      };
    } catch {
      return failedSelfTest();
    } finally {
      try {
        fs.rmSync(inputPath, { force: true });
      } catch {
        // A failed temporary cleanup does not change the self-test's package identity verdict.
      }
    }
  }
}

function unavailableComposition(
  manifestPath: string,
  nativeAdapter: NativeImageOcrAdapterPort,
  processRunner: PaddleOcrProcessRunner | undefined,
  platform: NodeJS.Platform,
  architecture: NodeJS.Architecture
): PaddleOcrRuntimeComposition {
  return {
    lifecycle: createUnavailablePaddleOcrLifecycleService(manifestPath, platform, architecture),
    adapter: new NativeOcrAdapterRouter(
      nativeAdapter,
      new PaddleOcrAdapter(unavailableLeasePort(), processRunner ?? new SpawnPaddleOcrProcessRunner())
    ),
    recoverStaging: () => undefined
  };
}

function createReviewedBundleMaterializer(
  release: ReviewedPaddleOcrAvailableBundle,
  engineVersion: string,
  appDataRoot: string,
  signingKeys: readonly {
    readonly algorithm: "Ed25519";
    readonly keyId: string;
    readonly publicKeySpkiBase64: string;
  }[],
  trustedReleaseOrigins: readonly string[]
): PaddleOcrBundleMaterializerPort | undefined {
  const publicKeys = new Map<string, KeyLike>();
  try {
    for (const signingKey of signingKeys) {
      if (signingKey.algorithm !== "Ed25519" || publicKeys.has(signingKey.keyId)) return undefined;
      publicKeys.set(signingKey.keyId, createPublicKey({
        key: Buffer.from(signingKey.publicKeySpkiBase64, "base64"),
        format: "der",
        type: "spki"
      }));
    }
    if (!publicKeys.has(release.signature.keyId)) return undefined;
    return new PaddleOcrBundleMaterializer({
      bundle: release,
      engineVersion,
      stagingRoot: path.join(appDataRoot, "local-tools", ".paddleocr-downloads"),
      redirectOrigins: trustedReleaseOrigins,
      publicKeys
    });
  } catch {
    return undefined;
  }
}

function bridgeSettingsOrigin(value: string): string {
  if (value !== PADDLE_SETTINGS_ORIGIN) {
    throw new PigeDomainError("permission.binding_changed", "The PaddleOCR Settings origin changed.");
  }
  return LOCAL_TOOL_USER_ORIGIN;
}

function normalizeDigest(value: string): string {
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function fixedLeasePort(lease: PaddleOcrRuntimeLease): PaddleOcrRuntimeLeasePort {
  return {
    isAvailable: () => true,
    withVerifiedRuntime: (callback) => callback(lease)
  };
}

function unavailableLeasePort(): PaddleOcrRuntimeLeasePort {
  return {
    isAvailable: () => false,
    withVerifiedRuntime: async () => {
      throw new PigeDomainError("ocr.helper_unavailable", "The managed PaddleOCR runtime is unavailable.");
    }
  };
}

function failedSelfTest(): LocalToolSelfTestResult {
  return { schemaVersion: 1, passed: false, outputBytes: 0, messageCode: "local_tool.test_failed" };
}

function requirePrivateAppDataRoot(value: string): string {
  const root = path.resolve(value);
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const entry = fs.lstatSync(root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new PigeDomainError("settings.local_tool_root_invalid", "The app-data root is not a private directory.");
  }
  return root;
}
