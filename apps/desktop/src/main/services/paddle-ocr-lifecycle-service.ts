import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  PADDLE_OCR_ENGINE_ID,
  type PaddleOcrCatalogComponent,
  type PaddleOcrDisableRequest,
  type PaddleOcrDisableResult,
  type PaddleOcrEnableRequest,
  type PaddleOcrEnableResult,
  type PaddleOcrInstallRequest,
  type PaddleOcrInstallResult,
  type PaddleOcrRemoveRequest,
  type PaddleOcrRemoveResult,
  type PaddleOcrSummary,
  type PaddleOcrSummaryRequest,
  type PaddleOcrTestRequest,
  type PaddleOcrTestResult
} from "@pige/schemas";
import type {
  LocalToolInspection,
  LocalToolLifecycleResult
} from "./local-tool-manager-types";
import {
  resolveLocalToolPackageLimits,
  type LocalToolPackageLimits
} from "./local-tool-package";
import type { ReviewedPaddleOcrAvailableBundle } from "./paddle-ocr-bundle-materializer";

const USER_ORIGIN = "settings.local_capabilities";

export interface PaddleOcrReviewedCatalog {
  readonly catalogVersion: string;
  readonly components: readonly PaddleOcrCatalogComponent[];
  readonly downloadSizeBytes: number;
  readonly installable: boolean;
}

export interface PaddleOcrBundleCandidate {
  readonly version: string;
  readonly candidatePath: string;
  readonly expectedSha256: string;
}

export interface PaddleOcrBundleMaterializerPort {
  materialize(requestId: string): Promise<PaddleOcrBundleCandidate>;
  discard(requestId: string): void | Promise<void>;
}

export interface PaddleOcrLocalToolManagerPort {
  inspect(toolId: string): LocalToolInspection;
  install(request: {
    readonly requestId: string;
    readonly userOrigin: string;
    readonly toolId: string;
    readonly version: string;
    readonly candidatePath: string;
    readonly expectedSha256: string;
  }): Promise<LocalToolLifecycleResult>;
  setEnabled(request: {
    readonly requestId: string;
    readonly userOrigin: string;
    readonly toolId: string;
    readonly version?: string;
    readonly enabled: boolean;
  }): LocalToolLifecycleResult | Promise<LocalToolLifecycleResult>;
  test(request: {
    readonly requestId: string;
    readonly userOrigin: string;
    readonly toolId: string;
    readonly version?: string;
  }): Promise<LocalToolLifecycleResult>;
  remove(request: {
    readonly requestId: string;
    readonly userOrigin: string;
    readonly toolId: string;
    readonly version?: string;
  }): LocalToolLifecycleResult | Promise<LocalToolLifecycleResult>;
}

interface PaddleOcrLifecycleServiceOptions {
  readonly catalog: PaddleOcrReviewedCatalog;
  readonly manager: PaddleOcrLocalToolManagerPort;
  readonly materializer: PaddleOcrBundleMaterializerPort;
}

type PaddleOcrPlatform = "macos-arm64" | "windows-x64";

export interface ReviewedPaddleOcrAwaitingBundle {
  readonly platform: PaddleOcrPlatform;
  readonly state: "awaiting_release_artifact";
}

export interface PaddleOcrReviewedManifestProjection {
  readonly engineVersion: string;
  readonly catalog: PaddleOcrReviewedCatalog;
  readonly releaseBundle: ReviewedPaddleOcrAwaitingBundle | ReviewedPaddleOcrAvailableBundle | undefined;
  readonly releaseSigningKeys: readonly PaddleOcrReleaseSigningKey[];
  readonly trustedReleaseOrigins: readonly string[];
}

export interface PaddleOcrReleaseSigningKey {
  readonly algorithm: "Ed25519";
  readonly keyId: string;
  readonly publicKeySpkiBase64: string;
}

interface ReviewedPaddleOcrManifest {
  readonly id: typeof PADDLE_OCR_ENGINE_ID;
  readonly catalogVersion: string;
  readonly engineVersion: string;
  readonly pythonRuntime: {
    readonly version: string;
    readonly assets: readonly ReviewedAsset[];
  };
  readonly pythonPackages: readonly ReviewedPackage[];
  readonly paddlePaddle: {
    readonly version: string;
    readonly assets: readonly ReviewedAsset[];
  };
  readonly models: readonly ReviewedModel[];
  readonly releaseBundles: readonly (ReviewedPaddleOcrAwaitingBundle | ReviewedPaddleOcrAvailableBundle)[];
  readonly releaseSigningKeys: readonly PaddleOcrReleaseSigningKey[];
  readonly trustedReleaseOrigins: readonly string[];
}

interface ReviewedAsset {
  readonly platform: PaddleOcrPlatform;
  readonly sizeBytes: number;
}

interface ReviewedPackage {
  readonly name: string;
  readonly version: string;
  readonly sizeBytes: number;
}

interface ReviewedModel {
  readonly id: string;
  readonly sizeBytes: number;
}

export function createUnavailablePaddleOcrLifecycleService(
  manifestPath: string,
  platform = process.platform,
  architecture = process.arch
): PaddleOcrLifecycleService {
  const manifest = parseReviewedManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const target = platform === "darwin" && architecture === "arm64"
    ? "macos-arm64"
    : platform === "win32" && architecture === "x64"
      ? "windows-x64"
      : undefined;
  const catalog = projectReviewedCatalog(manifest, target, false);
  return new PaddleOcrLifecycleService({
    catalog,
    manager: unavailableManager(manifest.engineVersion),
    materializer: {
      materialize: async () => {
        throw new Error("The reviewed PaddleOCR release bundle is unavailable.");
      },
      discard: () => undefined
    }
  });
}

export function readPaddleOcrReviewedManifest(
  manifestPath: string,
  platform = process.platform,
  architecture = process.arch
): PaddleOcrReviewedManifestProjection {
  const manifest = parseReviewedManifest(JSON.parse(readFileSync(manifestPath, "utf8")));
  const target = platform === "darwin" && architecture === "arm64"
    ? "macos-arm64"
    : platform === "win32" && architecture === "x64"
      ? "windows-x64"
      : undefined;
  const releaseBundle = manifest.releaseBundles.find((entry) => entry.platform === target);
  return {
    engineVersion: manifest.engineVersion,
    catalog: projectReviewedCatalog(manifest, target, releaseBundle?.state === "available"),
    releaseBundle,
    releaseSigningKeys: manifest.releaseSigningKeys,
    trustedReleaseOrigins: manifest.trustedReleaseOrigins
  };
}

export class PaddleOcrLifecycleService {
  readonly #catalog: PaddleOcrReviewedCatalog;
  readonly #manager: PaddleOcrLocalToolManagerPort;
  readonly #materializer: PaddleOcrBundleMaterializerPort;

  constructor(options: PaddleOcrLifecycleServiceOptions) {
    this.#catalog = options.catalog;
    this.#manager = options.manager;
    this.#materializer = options.materializer;
  }

  summary(_request: PaddleOcrSummaryRequest): PaddleOcrSummary {
    return this.#summary();
  }

  async install(request: PaddleOcrInstallRequest): Promise<PaddleOcrInstallResult> {
    const before = this.#summary();
    if (request.expectedRevision !== before.revision) return authoritative(request, "stale", before);
    if (before.state === "ready" || before.state === "disabled") {
      return authoritative(request, "already_installed", before);
    }
    if (!before.canInstall || !this.#catalog.installable) return failed(request);

    let materialized = false;
    try {
      const candidate = await this.#materializer.materialize(request.requestId);
      materialized = true;
      if (request.expectedRevision !== this.#summary().revision) return authoritative(request, "stale", this.#summary());
      const result = await this.#manager.install({
        requestId: request.requestId,
        userOrigin: USER_ORIGIN,
        toolId: PADDLE_OCR_ENGINE_ID,
        version: candidate.version,
        candidatePath: candidate.candidatePath,
        expectedSha256: candidate.expectedSha256
      });
      if (!jobCompleted(result)) return failed(request);
      return {
        ...identity(request),
        status: "accepted",
        jobId: result.job.id,
        summary: this.#summary()
      };
    } catch {
      return failed(request);
    } finally {
      if (materialized) await this.#materializer.discard(request.requestId);
    }
  }

  enable(request: PaddleOcrEnableRequest): Promise<PaddleOcrEnableResult> {
    return this.#setEnabled(request, true);
  }

  async test(request: PaddleOcrTestRequest): Promise<PaddleOcrTestResult> {
    const before = this.#summary();
    if (request.expectedRevision !== before.revision) return authoritative(request, "stale", before);
    if (!before.canTest) return authoritative(request, "not_found", before);
    try {
      const result = await this.#manager.test(actionRequest(request, activeVersion(this.#manager)));
      if (!jobCompleted(result)) return failed(request);
      return {
        ...identity(request),
        status: "accepted",
        jobId: result.job.id,
        summary: this.#summary()
      };
    } catch {
      return failed(request);
    }
  }

  disable(request: PaddleOcrDisableRequest): Promise<PaddleOcrDisableResult> {
    return this.#setEnabled(request, false);
  }

  async remove(request: PaddleOcrRemoveRequest): Promise<PaddleOcrRemoveResult> {
    const before = this.#summary();
    if (request.expectedRevision !== before.revision) return authoritative(request, "stale", before);
    if (!before.canRemove) return authoritative(request, "not_found", before);
    try {
      const result = await this.#manager.remove(actionRequest(request, activeVersion(this.#manager)));
      if (!jobCompleted(result)) return failed(request);
      return authoritative(request, "committed", this.#summary());
    } catch {
      return failed(request);
    }
  }

  #setEnabled(
    request: PaddleOcrEnableRequest,
    enabled: true
  ): Promise<PaddleOcrEnableResult>;
  #setEnabled(
    request: PaddleOcrDisableRequest,
    enabled: false
  ): Promise<PaddleOcrDisableResult>;
  async #setEnabled(
    request: PaddleOcrEnableRequest,
    enabled: boolean
  ): Promise<PaddleOcrEnableResult | PaddleOcrDisableResult> {
    const before = this.#summary();
    if (request.expectedRevision !== before.revision) return authoritative(request, "stale", before);
    if (enabled ? before.state === "ready" : before.state === "disabled") {
      return authoritative(request, enabled ? "already_enabled" : "already_current", before);
    }
    if (enabled ? !before.canEnable : !before.canDisable) {
      return authoritative(request, "not_found", before);
    }
    try {
      const result = await this.#manager.setEnabled({
        ...actionRequest(request, activeVersion(this.#manager)),
        enabled
      });
      if (!jobCompleted(result)) return failed(request);
      return authoritative(request, "committed", this.#summary());
    } catch {
      return failed(request);
    }
  }

  #summary(): PaddleOcrSummary {
    let inspection: LocalToolInspection | undefined;
    try {
      inspection = this.#manager.inspect(PADDLE_OCR_ENGINE_ID);
    } catch {
      inspection = undefined;
    }
    const state = lifecycleState(inspection, this.#catalog.installable);
    const actions = state === "not_installed"
      ? [true, false, false, false, false]
      : state === "ready"
        ? [false, false, true, true, true]
        : state === "disabled"
          ? [false, true, true, false, true]
          : state === "needs_repair"
            ? [false, false, false, false, true]
            : [false, false, false, false, false];
    return {
      apiVersion: 1,
      revision: revisionFor(this.#catalog, inspection),
      engineId: PADDLE_OCR_ENGINE_ID,
      state,
      catalogVersion: this.#catalog.catalogVersion,
      components: this.#catalog.components,
      downloadSizeBytes: this.#catalog.downloadSizeBytes,
      nativeOcrPreferred: true,
      hiddenDownloadsAllowed: false,
      canInstall: actions[0]!,
      canEnable: actions[1]!,
      canTest: actions[2]!,
      canDisable: actions[3]!,
      canRemove: actions[4]!
    };
  }
}

function lifecycleState(
  inspection: LocalToolInspection | undefined,
  installable: boolean
): PaddleOcrSummary["state"] {
  if (!inspection || inspection.installState === "unsupported") return "unsupported";
  if (inspection.installState === "available") return installable ? "not_installed" : "unsupported";
  if (inspection.installState === "repair_needed" || inspection.installState === "needs_update" ||
    inspection.installState === "error" || !inspection.healthy) return "needs_repair";
  return inspection.enabled && inspection.routable ? "ready" : "disabled";
}

function revisionFor(
  catalog: PaddleOcrReviewedCatalog,
  inspection: LocalToolInspection | undefined
): number {
  const digest = createHash("sha256").update(JSON.stringify({ catalog, inspection })).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16);
}

function identity(request: { readonly apiVersion: 1; readonly requestId: string }) {
  return { apiVersion: request.apiVersion, requestId: request.requestId, engineId: PADDLE_OCR_ENGINE_ID } as const;
}

function authoritative<T extends string>(
  request: { readonly apiVersion: 1; readonly requestId: string },
  status: T,
  summary: PaddleOcrSummary
) {
  return { ...identity(request), status, summary } as const;
}

function failed(request: { readonly apiVersion: 1; readonly requestId: string }) {
  return { ...identity(request), status: "failed" as const };
}

function actionRequest(
  request: { readonly requestId: string },
  version: string | undefined
) {
  return {
    requestId: request.requestId,
    userOrigin: USER_ORIGIN,
    toolId: PADDLE_OCR_ENGINE_ID,
    ...(version ? { version } : {})
  };
}

function activeVersion(manager: PaddleOcrLocalToolManagerPort): string | undefined {
  try {
    return manager.inspect(PADDLE_OCR_ENGINE_ID).activeVersion;
  } catch {
    return undefined;
  }
}

function jobCompleted(result: LocalToolLifecycleResult): boolean {
  return result.job.state === "completed" || result.job.state === "completed_with_warnings";
}

function parseReviewedManifest(value: unknown): ReviewedPaddleOcrManifest {
  const manifest = requireRecord(value);
  if (
    manifest.id !== PADDLE_OCR_ENGINE_ID ||
    !isBoundedString(manifest.catalogVersion, 64) ||
    !isBoundedString(manifest.engineVersion, 64)
  ) {
    throw new Error("Invalid reviewed PaddleOCR catalog identity.");
  }
  const pythonRuntime = requireRecord(manifest.pythonRuntime);
  const paddlePaddle = requireRecord(manifest.paddlePaddle);
  const pythonPackages = requireArray(manifest.pythonPackages).map(parsePackage);
  const models = requireArray(manifest.models).map(parseModel);
  const releaseBundles = requireArray(manifest.releaseBundles).map(parseReleaseBundle);
  const releaseSigningKeys = manifest.releaseSigningKeys === undefined
    ? []
    : requireArray(manifest.releaseSigningKeys).map(parseReleaseSigningKey);
  const trustedOrigins = requireRecord(manifest.trustedOrigins);
  const trustedReleaseOrigins = requireArray(trustedOrigins.releaseInputs).map(requireHttpsOrigin);
  const releasePlatforms = new Set(releaseBundles.map((entry) => entry.platform));
  const releaseKeyIds = new Set(releaseSigningKeys.map((entry) => entry.keyId));
  if (
    pythonPackages.length === 0 ||
    models.length === 0 ||
    releaseBundles.length !== 2 ||
    releasePlatforms.size !== 2 ||
    releaseKeyIds.size !== releaseSigningKeys.length ||
    new Set(trustedReleaseOrigins).size !== trustedReleaseOrigins.length ||
    trustedReleaseOrigins.length === 0 ||
    !releasePlatforms.has("macos-arm64") ||
    !releasePlatforms.has("windows-x64")
  ) {
    throw new Error("The reviewed PaddleOCR catalog is incomplete.");
  }
  return {
    id: PADDLE_OCR_ENGINE_ID,
    catalogVersion: manifest.catalogVersion,
    engineVersion: manifest.engineVersion,
    pythonRuntime: {
      version: requireVersion(pythonRuntime.version),
      assets: requireArray(pythonRuntime.assets).map(parseAsset)
    },
    pythonPackages,
    paddlePaddle: {
      version: requireVersion(paddlePaddle.version),
      assets: requireArray(paddlePaddle.assets).map(parseAsset)
    },
    models,
    releaseBundles,
    releaseSigningKeys,
    trustedReleaseOrigins
  };
}

function parseReleaseSigningKey(value: unknown): PaddleOcrReleaseSigningKey {
  const key = requireRecord(value);
  if (
    Object.keys(key).sort().join("\0") !== ["algorithm", "keyId", "publicKeySpkiBase64"].join("\0") ||
    key.algorithm !== "Ed25519" ||
    !isBoundedString(key.keyId, 80) ||
    !isBoundedString(key.publicKeySpkiBase64, 1_024)
  ) {
    throw new Error("Invalid PaddleOCR release signing key.");
  }
  return {
    algorithm: "Ed25519",
    keyId: key.keyId,
    publicKeySpkiBase64: key.publicKeySpkiBase64
  };
}

function requireHttpsOrigin(value: unknown): string {
  if (!isBoundedString(value, 256)) throw new Error("Invalid PaddleOCR release origin.");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.origin !== value) {
    throw new Error("Invalid PaddleOCR release origin.");
  }
  return value;
}

function projectReviewedCatalog(
  manifest: ReviewedPaddleOcrManifest,
  platform: PaddleOcrPlatform | undefined,
  installable: boolean
): PaddleOcrReviewedCatalog {
  const pythonAsset = manifest.pythonRuntime.assets.find((asset) => asset.platform === platform);
  const paddleAsset = manifest.paddlePaddle.assets.find((asset) => asset.platform === platform);
  const components: PaddleOcrCatalogComponent[] = [
    component("python-runtime", "python_runtime", "Python runtime", manifest.pythonRuntime.version, pythonAsset?.sizeBytes ?? 0),
    component("paddlepaddle", "engine", "PaddlePaddle CPU", manifest.paddlePaddle.version, paddleAsset?.sizeBytes ?? 0),
    ...manifest.pythonPackages.map((entry) =>
      component(entry.name, "engine", packageLabel(entry.name), entry.version, entry.sizeBytes)
    ),
    ...manifest.models.map((entry) =>
      component(`model.${entry.id.toLowerCase()}`, "model", entry.id, manifest.engineVersion, entry.sizeBytes)
    )
  ];
  const releaseBundle = manifest.releaseBundles.find((entry) => entry.platform === platform);
  return {
    catalogVersion: manifest.catalogVersion,
    components,
    downloadSizeBytes: installable && releaseBundle?.state === "available"
      ? releaseBundle.sizeBytes
      : components.reduce((total, entry) => total + entry.sizeBytes, 0),
    installable
  };
}

function parseReleaseBundle(value: unknown): ReviewedPaddleOcrAwaitingBundle | ReviewedPaddleOcrAvailableBundle {
  const bundle = requireRecord(value);
  if (!isPaddleOcrPlatform(bundle.platform)) throw new Error("Invalid PaddleOCR release bundle platform.");
  if (bundle.state === "awaiting_release_artifact") {
    return { platform: bundle.platform, state: "awaiting_release_artifact" };
  }
  if (bundle.state !== "available") throw new Error("Invalid PaddleOCR release bundle state.");
  const signature = requireRecord(bundle.signature);
  if (
    signature.algorithm !== "Ed25519" ||
    !isBoundedString(signature.keyId, 80) ||
    !isBoundedString(signature.valueBase64, 256)
  ) {
    throw new Error("Invalid PaddleOCR release bundle signature.");
  }
  return {
    platform: bundle.platform,
    state: "available",
    artifactUrl: requireHttpsUrl(bundle.artifactUrl),
    sizeBytes: requireSize(bundle.sizeBytes),
    sha256: requireDigest(bundle.sha256),
    signature: {
      algorithm: "Ed25519",
      keyId: signature.keyId,
      valueBase64: signature.valueBase64
    },
    sbomSha256: requireDigest(bundle.sbomSha256),
    installedTreeSha256: requireDigest(bundle.installedTreeSha256),
    installedSizeBytes: requireSize(bundle.installedSizeBytes),
    wrapperSha256: requireDigest(bundle.wrapperSha256),
    packageLimits: parsePackageLimits(bundle.packageLimits)
  };
}

function parsePackageLimits(value: unknown): LocalToolPackageLimits {
  const limits = requireRecord(value);
  if (Object.keys(limits).sort().join("\0") !==
    ["maxFileBytes", "maxFiles", "maxManifestBytes", "maxTotalBytes"].join("\0")) {
    throw new Error("Invalid PaddleOCR package limits.");
  }
  return resolveLocalToolPackageLimits({
    maxManifestBytes: requireSize(limits.maxManifestBytes),
    maxFileBytes: requireSize(limits.maxFileBytes),
    maxTotalBytes: requireSize(limits.maxTotalBytes),
    maxFiles: requireSize(limits.maxFiles)
  });
}

function unavailableManager(version: string): PaddleOcrLocalToolManagerPort {
  const unavailable = async (): Promise<LocalToolLifecycleResult> => {
    throw new Error("The reviewed PaddleOCR release bundle is unavailable.");
  };
  return {
    inspect: () => ({
      toolId: PADDLE_OCR_ENGINE_ID,
      label: "PaddleOCR local engine",
      installState: "unsupported",
      enabled: false,
      healthy: false,
      routable: false,
      desiredVersion: version,
      platform: normalizeManagerPlatform(process.platform),
      architecture: process.arch === "arm64" ? "arm64" : "x64",
      capabilities: ["ocr.image"],
      license: { spdxId: "Apache-2.0", name: "Apache License 2.0" },
      assets: [],
      routedCapabilities: []
    }),
    install: unavailable,
    setEnabled: unavailable,
    test: unavailable,
    remove: unavailable
  };
}

function component(
  componentId: string,
  kind: PaddleOcrCatalogComponent["kind"],
  label: string,
  version: string,
  sizeBytes: number
): PaddleOcrCatalogComponent {
  return { componentId, kind, label, version, sizeBytes };
}

function parseAsset(value: unknown): ReviewedAsset {
  const asset = requireRecord(value);
  if (!isPaddleOcrPlatform(asset.platform)) throw new Error("Invalid PaddleOCR asset platform.");
  return { platform: asset.platform, sizeBytes: requireSize(asset.sizeBytes) };
}

function parsePackage(value: unknown): ReviewedPackage {
  const entry = requireRecord(value);
  return {
    name: requireIdentifier(entry.name),
    version: requireVersion(entry.version),
    sizeBytes: requireSize(entry.sizeBytes)
  };
}

function parseModel(value: unknown): ReviewedModel {
  const entry = requireRecord(value);
  return { id: requireIdentifier(entry.id), sizeBytes: requireSize(entry.sizeBytes) };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected catalog object.");
  return value as Record<string, unknown>;
}

function requireArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected catalog array.");
  return value;
}

function requireIdentifier(value: unknown): string {
  if (!isBoundedString(value, 64) || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value)) {
    throw new Error("Invalid catalog identifier.");
  }
  return value;
}

function requireVersion(value: unknown): string {
  if (!isBoundedString(value, 64)) throw new Error("Invalid catalog version.");
  return value;
}

function requireSize(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new Error("Invalid catalog size.");
  return value as number;
}

function requireDigest(value: unknown): string {
  if (typeof value !== "string" || !/^(?:sha256:)?[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Invalid catalog digest.");
  }
  return value;
}

function requireHttpsUrl(value: unknown): string {
  if (!isBoundedString(value, 2_048)) throw new Error("Invalid catalog artifact URL.");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href !== value) {
    throw new Error("Invalid catalog artifact URL.");
  }
  return value;
}

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function isPaddleOcrPlatform(value: unknown): value is PaddleOcrPlatform {
  return value === "macos-arm64" || value === "windows-x64";
}

function packageLabel(name: string): string {
  return name === "paddleocr" ? "PaddleOCR" : name === "paddlex" ? "PaddleX" : name;
}

function normalizeManagerPlatform(value: NodeJS.Platform): "macos" | "windows" | "linux" {
  return value === "darwin" ? "macos" : value === "win32" ? "windows" : "linux";
}
