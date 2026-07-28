import { createHash } from "node:crypto";
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
