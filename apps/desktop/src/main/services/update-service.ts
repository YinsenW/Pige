import type {
  UpdateCapability,
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateStatusEvent,
  UpdateSummary
} from "@pige/contracts";
import {
  UpdateCheckResultSchema,
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

export interface UpdateCheckAdapter {
  readonly capability: UpdateCapability;
  check(input: {
    readonly channel: "alpha";
    readonly currentVersion: string;
  }): Promise<UpdateAdapterCheckResult>;
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
}

export interface UpdateServiceOptions {
  readonly settings: LocalSettingsStore;
  readonly adapter: UpdateCheckAdapter;
  readonly currentVersion: string;
  readonly publish: (event: UpdateStatusEvent) => void;
  readonly now?: () => Date;
}

export class UpdateService {
  readonly #settings: LocalSettingsStore;
  readonly #adapter: UpdateCheckAdapter;
  readonly #currentVersion: string;
  readonly #publish: (event: UpdateStatusEvent) => void;
  readonly #now: () => Date;
  #activeRequestId: string | undefined;
  #eventSequence = 0;

  constructor(options: UpdateServiceOptions) {
    this.#settings = options.settings;
    this.#adapter = options.adapter;
    this.#currentVersion = UpdateVersionSchema.parse(options.currentVersion);
    this.#publish = options.publish;
    this.#now = options.now ?? (() => new Date());
  }

  summary(): UpdateSummary {
    return projectSummary(
      this.#settings.getUpdateSettings(),
      this.#adapter.capability,
      this.#currentVersion,
      this.#activeRequestId !== undefined
    );
  }

  async check(request: UpdateCheckRequest): Promise<UpdateCheckResult> {
    if (this.#activeRequestId) {
      return parseResult("busy", request.requestId, this.summary());
    }
    if (this.#adapter.capability !== "packaged_ready") {
      return parseResult("unavailable", request.requestId, this.summary());
    }

    const current = this.#settings.getUpdateSettings();
    this.#activeRequestId = request.requestId;
    this.#publishEvent(request.requestId, this.summary());
    try {
      const adapterResult = await this.#adapter.check({
        channel: current.channel,
        currentVersion: this.#currentVersion
      });
      if (adapterResult.status === "unavailable") {
        this.#activeRequestId = undefined;
        const summary = this.summary();
        this.#publishEvent(request.requestId, summary);
        return parseResult("unavailable", request.requestId, summary);
      }

      const checkedAt = this.#now().toISOString();
      const terminal = toTerminalState(adapterResult, checkedAt);
      const mutation = this.#settings.mutateUpdateSettings(current.revision, (settings) =>
        UpdateMachineSettingsSchema.parse({
          ...settings,
          channel: "alpha",
          lastCheck: terminal
        })
      );
      this.#activeRequestId = undefined;
      const summary = projectSummary(
        mutation.settings,
        this.#adapter.capability,
        this.#currentVersion,
        false
      );
      this.#publishEvent(request.requestId, summary);
      return parseResult(mutation.status === "stale" ? "stale" : "checked", request.requestId, summary);
    } catch {
      const mutation = this.#settings.mutateUpdateSettings(current.revision, (settings) =>
        UpdateMachineSettingsSchema.parse({
          ...settings,
          channel: "alpha",
          lastCheck: { phase: "failed", checkedAt: this.#now().toISOString() }
        })
      );
      this.#activeRequestId = undefined;
      const summary = projectSummary(
        mutation.settings,
        this.#adapter.capability,
        this.#currentVersion,
        false
      );
      this.#publishEvent(request.requestId, summary);
      return parseResult(mutation.status === "stale" ? "stale" : "checked", request.requestId, summary);
    } finally {
      this.#activeRequestId = undefined;
    }
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
      // Event delivery is observational and cannot change the durable check result.
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
  checking: boolean
): UpdateSummary {
  const base = {
    apiVersion: 1 as const,
    revision: settings.revision,
    channel: settings.channel,
    capability,
    currentVersion
  };
  if (checking) return UpdateSummarySchema.parse({ ...base, phase: "checking" });
  if (capability !== "packaged_ready" || !settings.lastCheck) {
    return UpdateSummarySchema.parse({ ...base, phase: "idle" });
  }
  return UpdateSummarySchema.parse({ ...base, ...settings.lastCheck });
}

function parseResult(
  status: UpdateCheckResult["status"],
  requestId: string,
  summary: UpdateSummary
): UpdateCheckResult {
  return UpdateCheckResultSchema.parse({ status, requestId, summary });
}
