import { createPublicKey, randomUUID, type KeyLike } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PigeDomainError } from "@pige/domain";
import { PADDLE_OCR_ENGINE_ID, type OcrEnginePreference } from "@pige/schemas";
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
  "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",
  "base64"
);

export interface PaddleOcrRuntimeCompositionOptions {
  readonly appDataRoot: string;
  readonly manifestPath: string;
  readonly assertAppInstanceWriterLease: () => void;
  readonly bundleMaterializer?: PaddleOcrBundleMaterializerPort;
  readonly nativeAdapter?: NativeImageOcrAdapterPort;
  readonly processRunner?: PaddleOcrProcessRunner;
  readonly enginePreference?: () => OcrEnginePreference;
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
    return unavailableComposition(
      options.manifestPath,
      nativeAdapter,
      options.processRunner,
      platform,
      architecture,
      options.enginePreference
    );
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
    return unavailableComposition(
      options.manifestPath,
      nativeAdapter,
      options.processRunner,
      platform,
      architecture,
      options.enginePreference
    );
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
    license: {
      spdxId: "LicenseRef-Pige-PaddleOCR-3.7.0-Aggregate-Legal-Inventory",
      name: "See bundled legal inventory"
    },
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
    adapter: new NativeOcrAdapterRouter(
      nativeAdapter,
      new PaddleOcrAdapter(leasePort, processRunner),
      options.enginePreference
    ),
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
  architecture: NodeJS.Architecture,
  enginePreference?: () => OcrEnginePreference
): PaddleOcrRuntimeComposition {
  return {
    lifecycle: createUnavailablePaddleOcrLifecycleService(manifestPath, platform, architecture),
    adapter: new NativeOcrAdapterRouter(
      nativeAdapter,
      new PaddleOcrAdapter(unavailableLeasePort(), processRunner ?? new SpawnPaddleOcrProcessRunner()),
      enginePreference
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
