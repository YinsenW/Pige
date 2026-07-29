import type {
  UpdateApplyRequest,
  UpdateApplyResult,
  UpdateCapability,
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateDownloadRequest,
  UpdateDownloadResult,
  UpdateStatusEvent,
  UpdateSummary
} from "@pige/contracts";
import {
  UpdateApplyResultSchema,
  UpdateCheckResultSchema,
  UpdateDownloadResultSchema,
  UpdateMachineSettingsSchema,
  UpdateStatusEventSchema,
  UpdateSummarySchema,
  UpdateVersionSchema,
  type UpdateMachineSettings
} from "@pige/schemas";
import { LocalSettingsStore } from "./local-settings";

export type UpdateAdapterCheckResult =
  | { readonly status: "up_to_date" }
  | { readonly status: "available"; readonly availableVersion: string }
  | { readonly status: "failed" }
  | { readonly status: "unavailable" };

export type UpdateAdapterDownloadResult = "ready" | "failed" | "unavailable";

export interface UpdateCheckAdapter {
  readonly capability: UpdateCapability;
  check(input: {
    readonly channel: "alpha";
    readonly currentVersion: string;
  }): Promise<UpdateAdapterCheckResult>;
  download(input: {
    readonly version: string;
    readonly onProgress: (percent: number) => void;
  }): Promise<UpdateAdapterDownloadResult>;
  prepareApply(version: string): Promise<UpdateAdapterDownloadResult>;
  apply(version: string): boolean;
}

export class NoNetworkUpdateCheckAdapter implements UpdateCheckAdapter {
  readonly capability: UpdateCapability;

  constructor(platform: NodeJS.Platform = process.platform) {
    this.capability = platform === "darwin" || platform === "win32"
      ? "development"
      : "unsupported_platform";
  }

  async check(): Promise<UpdateAdapterCheckResult> {
    return { status: "unavailable" };
  }

  async download(): Promise<UpdateAdapterDownloadResult> {
    return "unavailable";
  }

  async prepareApply(): Promise<UpdateAdapterDownloadResult> {
    return "unavailable";
  }

  apply(): boolean {
    return false;
  }
}

export interface UpdateServiceOptions {
  readonly settings: LocalSettingsStore;
  readonly adapter: UpdateCheckAdapter;
  readonly currentVersion: string;
  readonly publish: (event: UpdateStatusEvent) => void;
  readonly hasBlockingWork?: () => boolean;
  readonly scheduleApply?: (apply: () => void) => void;
  readonly now?: () => Date;
}

type ActiveOperation = "check" | "download" | "apply";

export class UpdateService {
  readonly #settings: LocalSettingsStore;
  readonly #adapter: UpdateCheckAdapter;
  readonly #currentVersion: string;
  readonly #publish: (event: UpdateStatusEvent) => void;
  readonly #hasBlockingWork: () => boolean;
  readonly #scheduleApply: (apply: () => void) => void;
  readonly #now: () => Date;
  #activeRequestId: string | undefined;
  #activeOperation: ActiveOperation | undefined;
  #downloadProgressPercent = 0;
  #eventSequence = 0;

  constructor(options: UpdateServiceOptions) {
    this.#settings = options.settings;
    this.#adapter = options.adapter;
    this.#currentVersion = UpdateVersionSchema.parse(options.currentVersion);
    this.#publish = options.publish;
    this.#hasBlockingWork = options.hasBlockingWork ?? (() => false);
    this.#scheduleApply = options.scheduleApply ?? ((apply) => setImmediate(apply));
    this.#now = options.now ?? (() => new Date());
    this.#recoverInterruptedLifecycle();
  }

  summary(): UpdateSummary {
    return projectSummary(
      this.#settings.getUpdateSettings(),
      this.#adapter.capability,
      this.#currentVersion,
      this.#activeOperation === "check",
      this.#downloadProgressPercent
    );
  }

  async check(request: UpdateCheckRequest): Promise<UpdateCheckResult> {
    if (this.#activeRequestId || this.#settings.getUpdateSettings().lifecycle) {
      return parseCheckResult("busy", request.requestId, this.summary());
    }
    if (this.#adapter.capability !== "packaged_ready") {
      return parseCheckResult("unavailable", request.requestId, this.summary());
    }

    const current = this.#settings.getUpdateSettings();
    this.#activate("check", request.requestId);
    this.#publishEvent(request.requestId, this.summary());
    try {
      const adapterResult = await this.#adapter.check({
        channel: current.channel,
        currentVersion: this.#currentVersion
      });
      if (adapterResult.status === "unavailable") {
        this.#clearActive(request.requestId);
        const summary = this.summary();
        this.#publishEvent(request.requestId, summary);
        return parseCheckResult("unavailable", request.requestId, summary);
      }

      const mutation = this.#settings.mutateUpdateSettings(current.revision, (settings) =>
        UpdateMachineSettingsSchema.parse({
          ...settings,
          channel: "alpha",
          lastCheck: toTerminalState(adapterResult, this.#now().toISOString()),
          lifecycle: undefined
        })
      );
      this.#clearActive(request.requestId);
      const summary = projectSummary(mutation.settings, this.#adapter.capability, this.#currentVersion, false, 0);
      this.#publishEvent(request.requestId, summary);
      return parseCheckResult(mutation.status === "stale" ? "stale" : "checked", request.requestId, summary);
    } catch {
      const mutation = this.#settings.mutateUpdateSettings(current.revision, (settings) =>
        UpdateMachineSettingsSchema.parse({
          ...settings,
          channel: "alpha",
          lastCheck: { phase: "failed", checkedAt: this.#now().toISOString() },
          lifecycle: undefined
        })
      );
      this.#clearActive(request.requestId);
      const summary = projectSummary(mutation.settings, this.#adapter.capability, this.#currentVersion, false, 0);
      this.#publishEvent(request.requestId, summary);
      return parseCheckResult(mutation.status === "stale" ? "stale" : "checked", request.requestId, summary);
    } finally {
      this.#clearActive(request.requestId);
    }
  }

  download(request: UpdateDownloadRequest): UpdateDownloadResult {
    const current = this.#settings.getUpdateSettings();
    if (this.#adapter.capability !== "packaged_ready") return this.#downloadResult("unavailable", request);
    if (this.#activeRequestId) return this.#downloadResult("busy", request);
    if (current.revision !== request.expectedRevision) return this.#downloadResult("stale", request);
    if (
      current.lastCheck?.phase !== "available" ||
      current.lastCheck.availableVersion !== request.version
    ) return this.#downloadResult("stale", request);
    if (current.lifecycle?.phase === "ready_to_restart" && current.lifecycle.version === request.version) {
      return this.#downloadResult("already_ready", request);
    }
    if (current.lifecycle) return this.#downloadResult("busy", request);

    this.#activate("download", request.requestId);
    this.#downloadProgressPercent = 0;
    const mutation = this.#settings.mutateUpdateSettings(request.expectedRevision, (settings) =>
      UpdateMachineSettingsSchema.parse({
        ...settings,
        lifecycle: {
          phase: "downloading",
          version: request.version,
          startedAt: this.#now().toISOString()
        }
      })
    );
    if (mutation.status === "stale") {
      this.#clearActive(request.requestId);
      return this.#downloadResult("stale", request);
    }
    const summary = projectSummary(mutation.settings, this.#adapter.capability, this.#currentVersion, false, 0);
    this.#publishEvent(request.requestId, summary);
    void this.#finishDownload(request, mutation.settings.revision);
    return UpdateDownloadResultSchema.parse({
      status: "started",
      requestId: request.requestId,
      version: request.version,
      summary
    });
  }

  async apply(request: UpdateApplyRequest): Promise<UpdateApplyResult> {
    const current = this.#settings.getUpdateSettings();
    if (this.#adapter.capability !== "packaged_ready") return this.#applyResult("unavailable", request);
    if (this.#activeRequestId) return this.#applyResult("busy", request);
    if (
      current.revision !== request.expectedRevision ||
      current.lastCheck?.phase !== "available" ||
      current.lastCheck.availableVersion !== request.version ||
      current.lifecycle?.phase !== "ready_to_restart" ||
      current.lifecycle.version !== request.version
    ) return this.#applyResult("stale", request);
    if (this.#hasBlockingWork()) return this.#applyResult("blocked", request);

    this.#activate("apply", request.requestId);
    const prepared = await this.#adapter.prepareApply(request.version);
    if (prepared !== "ready") {
      this.#clearActive(request.requestId);
      return this.#applyResult(prepared === "unavailable" ? "unavailable" : "failed", request);
    }

    const revalidated = this.#settings.getUpdateSettings();
    if (
      revalidated.revision !== request.expectedRevision ||
      revalidated.lifecycle?.phase !== "ready_to_restart" ||
      revalidated.lifecycle.version !== request.version
    ) {
      this.#clearActive(request.requestId);
      return this.#applyResult("stale", request);
    }
    if (this.#hasBlockingWork()) {
      this.#clearActive(request.requestId);
      return this.#applyResult("blocked", request);
    }
    const readyAt = revalidated.lifecycle.readyAt;

    const mutation = this.#settings.mutateUpdateSettings(request.expectedRevision, (settings) =>
      UpdateMachineSettingsSchema.parse({
        ...settings,
        lifecycle: {
          phase: "applying",
          version: request.version,
          readyAt,
          startedAt: this.#now().toISOString()
        }
      })
    );
    if (mutation.status === "stale") {
      this.#clearActive(request.requestId);
      return this.#applyResult("stale", request);
    }
    this.#clearActive(request.requestId);
    const summary = projectSummary(mutation.settings, this.#adapter.capability, this.#currentVersion, false, 0);
    this.#publishEvent(request.requestId, summary);
    this.#scheduleApply(() => this.#applyPreparedUpdate(request, mutation.settings.revision));
    return UpdateApplyResultSchema.parse({
      status: "restarting",
      requestId: request.requestId,
      version: request.version,
      summary
    });
  }

  async #finishDownload(request: UpdateDownloadRequest, expectedRevision: number): Promise<void> {
    const result = await this.#adapter.download({
      version: request.version,
      onProgress: (percent) => this.#recordDownloadProgress(request, expectedRevision, percent)
    });
    if (this.#activeRequestId !== request.requestId || this.#activeOperation !== "download") return;
    const mutation = this.#settings.mutateUpdateSettings(expectedRevision, (settings) => {
      if (settings.lifecycle?.phase !== "downloading" || settings.lifecycle.version !== request.version) {
        return settings;
      }
      if (result === "ready") {
        return UpdateMachineSettingsSchema.parse({
          ...settings,
          lifecycle: {
            phase: "ready_to_restart",
            version: request.version,
            readyAt: this.#now().toISOString()
          }
        });
      }
      return UpdateMachineSettingsSchema.parse({
        ...settings,
        lastCheck: { phase: "failed", checkedAt: this.#now().toISOString() },
        lifecycle: undefined
      });
    });
    this.#clearActive(request.requestId);
    this.#downloadProgressPercent = 0;
    const summary = projectSummary(mutation.settings, this.#adapter.capability, this.#currentVersion, false, 0);
    this.#publishEvent(request.requestId, summary);
  }

  #recordDownloadProgress(request: UpdateDownloadRequest, expectedRevision: number, percent: number): void {
    if (this.#activeRequestId !== request.requestId || this.#activeOperation !== "download") return;
    const current = this.#settings.getUpdateSettings();
    if (
      current.revision !== expectedRevision ||
      current.lifecycle?.phase !== "downloading" ||
      current.lifecycle.version !== request.version
    ) return;
    this.#downloadProgressPercent = Math.min(100, Math.max(0, percent));
    this.#publishEvent(request.requestId, this.summary());
  }

  #applyPreparedUpdate(request: UpdateApplyRequest, expectedRevision: number): void {
    try {
      if (this.#adapter.apply(request.version)) return;
    } catch {
      // Revert to the exact ready state below so the user can retry safely.
    }
    const mutation = this.#settings.mutateUpdateSettings(expectedRevision, (settings) => {
      if (settings.lifecycle?.phase !== "applying" || settings.lifecycle.version !== request.version) return settings;
      return UpdateMachineSettingsSchema.parse({
        ...settings,
        lifecycle: {
          phase: "ready_to_restart",
          version: request.version,
          readyAt: settings.lifecycle.readyAt
        }
      });
    });
    this.#publishEvent(
      request.requestId,
      projectSummary(mutation.settings, this.#adapter.capability, this.#currentVersion, false, 0)
    );
  }

  #recoverInterruptedLifecycle(): void {
    const current = this.#settings.getUpdateSettings();
    const lifecycle = current.lifecycle;
    if (!lifecycle || lifecycle.phase === "ready_to_restart") return;
    this.#settings.mutateUpdateSettings(current.revision, (settings) =>
      UpdateMachineSettingsSchema.parse({
        ...settings,
        lifecycle: lifecycle.phase === "applying"
          ? {
              phase: "ready_to_restart",
              version: lifecycle.version,
              readyAt: lifecycle.readyAt
            }
          : undefined
      })
    );
  }

  #activate(operation: ActiveOperation, requestId: string): void {
    this.#activeOperation = operation;
    this.#activeRequestId = requestId;
  }

  #clearActive(requestId: string): void {
    if (this.#activeRequestId !== requestId) return;
    this.#activeRequestId = undefined;
    this.#activeOperation = undefined;
  }

  #downloadResult(status: Exclude<UpdateDownloadResult["status"], "started">, request: UpdateDownloadRequest): UpdateDownloadResult {
    return UpdateDownloadResultSchema.parse({
      status,
      requestId: request.requestId,
      version: request.version,
      summary: this.summary()
    });
  }

  #applyResult(status: Exclude<UpdateApplyResult["status"], "restarting">, request: UpdateApplyRequest): UpdateApplyResult {
    return UpdateApplyResultSchema.parse({
      status,
      requestId: request.requestId,
      version: request.version,
      summary: this.summary()
    });
  }

  #publishEvent(requestId: string, summary: UpdateSummary): void {
    if (this.#eventSequence === Number.MAX_SAFE_INTEGER) return;
    this.#eventSequence += 1;
    const event = UpdateStatusEventSchema.parse({
      apiVersion: 1,
      requestId,
      sequence: this.#eventSequence,
      summary
    });
    try {
      this.#publish(event);
    } catch {
      // Event delivery is observational and cannot change durable update state.
    }
  }
}

function toTerminalState(
  result: Exclude<UpdateAdapterCheckResult, { readonly status: "unavailable" }>,
  checkedAt: string
): UpdateMachineSettings["lastCheck"] {
  if (result.status === "available") {
    return {
      phase: "available",
      availableVersion: UpdateVersionSchema.parse(result.availableVersion),
      checkedAt
    };
  }
  return { phase: result.status, checkedAt };
}

function projectSummary(
  settings: UpdateMachineSettings,
  capability: UpdateCapability,
  currentVersion: string,
  checking: boolean,
  downloadProgressPercent: number
): UpdateSummary {
  const base = {
    apiVersion: 1 as const,
    revision: settings.revision,
    channel: settings.channel,
    capability,
    currentVersion
  };
  if (checking) return UpdateSummarySchema.parse({ ...base, phase: "checking" });
  if (capability !== "packaged_ready") return UpdateSummarySchema.parse({ ...base, phase: "idle" });
  if (settings.lifecycle && settings.lastCheck?.phase === "available") {
    if (settings.lifecycle.phase === "downloading") {
      return UpdateSummarySchema.parse({
        ...base,
        phase: "downloading",
        availableVersion: settings.lifecycle.version,
        checkedAt: settings.lastCheck.checkedAt,
        progressPercent: downloadProgressPercent
      });
    }
    return UpdateSummarySchema.parse({
      ...base,
      phase: settings.lifecycle.phase,
      availableVersion: settings.lifecycle.version,
      checkedAt: settings.lastCheck.checkedAt,
      readyAt: settings.lifecycle.readyAt
    });
  }
  if (!settings.lastCheck) return UpdateSummarySchema.parse({ ...base, phase: "idle" });
  return UpdateSummarySchema.parse({ ...base, ...settings.lastCheck });
}

function parseCheckResult(
  status: UpdateCheckResult["status"],
  requestId: string,
  summary: UpdateSummary
): UpdateCheckResult {
  return UpdateCheckResultSchema.parse({ status, requestId, summary });
}
