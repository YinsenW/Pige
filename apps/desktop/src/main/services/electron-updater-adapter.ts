import type { AppUpdater, UpdateCheckResult, UpdateDownloadedEvent } from "electron-updater";
import electronUpdater from "electron-updater";
import type { UpdateCapability } from "@pige/contracts";
import { UpdateVersionSchema } from "@pige/schemas";
import type {
  UpdateAdapterCheckResult,
  UpdateAdapterDownloadResult,
  UpdateCheckAdapter
} from "./update-service";

interface ElectronUpdaterClient {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  disableWebInstaller: boolean;
  logger: AppUpdater["logger"];
  checkForUpdates(): Promise<UpdateCheckResult | null>;
  downloadUpdate(): Promise<readonly string[]>;
  quitAndInstall(): void;
  on(event: "download-progress", listener: (progress: { readonly percent: number }) => void): this;
  on(event: "update-downloaded", listener: (event: UpdateDownloadedEvent) => void): this;
  on(event: "error", listener: (error: Error) => void): this;
  removeListener(event: "download-progress", listener: (progress: { readonly percent: number }) => void): this;
  removeListener(event: "update-downloaded", listener: (event: UpdateDownloadedEvent) => void): this;
}

export interface ElectronUpdaterAdapterOptions {
  readonly isPackaged: boolean;
  readonly platform?: NodeJS.Platform;
  readonly client?: ElectronUpdaterClient;
}

export class ElectronUpdaterAdapter implements UpdateCheckAdapter {
  readonly capability: UpdateCapability;
  readonly #client: ElectronUpdaterClient;
  #checkedVersion: string | undefined;
  #downloadedVersion: string | undefined;

  constructor(options: ElectronUpdaterAdapterOptions) {
    const platform = options.platform ?? process.platform;
    this.capability = options.isPackaged && platform === "darwin"
      ? "packaged_ready"
      : platform === "linux"
        ? "unsupported_platform"
        : "development";
    this.#client = options.client ?? electronUpdater.autoUpdater;
    this.#configureClient();
  }

  async check(input: {
    readonly channel: "alpha";
    readonly currentVersion: string;
  }): Promise<UpdateAdapterCheckResult> {
    if (this.capability !== "packaged_ready") return { status: "unavailable" };
    try {
      const result = await this.#client.checkForUpdates();
      if (!result) return { status: "unavailable" };
      if (!result.isUpdateAvailable) {
        this.#checkedVersion = undefined;
        this.#downloadedVersion = undefined;
        return { status: "up_to_date" };
      }
      const version = UpdateVersionSchema.parse(result.updateInfo.version);
      if (version === input.currentVersion) return { status: "up_to_date" };
      this.#checkedVersion = version;
      return { status: "available", availableVersion: version };
    } catch {
      return { status: "failed" };
    }
  }

  async download(input: {
    readonly version: string;
    readonly onProgress: (percent: number) => void;
  }): Promise<UpdateAdapterDownloadResult> {
    if (this.capability !== "packaged_ready") return "unavailable";
    if (this.#checkedVersion !== input.version) return "failed";
    return this.#downloadExactVersion(input.version, input.onProgress);
  }

  async prepareApply(version: string): Promise<UpdateAdapterDownloadResult> {
    if (this.capability !== "packaged_ready") return "unavailable";
    if (this.#downloadedVersion === version) return "ready";
    try {
      const result = await this.#client.checkForUpdates();
      if (!result?.isUpdateAvailable) return "failed";
      const checkedVersion = UpdateVersionSchema.parse(result.updateInfo.version);
      if (checkedVersion !== version) return "failed";
      this.#checkedVersion = checkedVersion;
      return this.#downloadExactVersion(version, () => undefined);
    } catch {
      return "failed";
    }
  }

  apply(version: string): boolean {
    if (this.capability !== "packaged_ready" || this.#downloadedVersion !== version) return false;
    this.#client.quitAndInstall();
    return true;
  }

  #configureClient(): void {
    this.#client.autoDownload = false;
    this.#client.autoInstallOnAppQuit = false;
    this.#client.allowPrerelease = true;
    this.#client.allowDowngrade = false;
    this.#client.disableWebInstaller = true;
    this.#client.logger = null;
    this.#client.on("error", () => undefined);
  }

  async #downloadExactVersion(
    version: string,
    onProgress: (percent: number) => void
  ): Promise<UpdateAdapterDownloadResult> {
    let downloadedVersion: string | undefined;
    const progressListener = (progress: { readonly percent: number }): void => {
      if (!Number.isFinite(progress.percent)) return;
      onProgress(Math.min(100, Math.max(0, progress.percent)));
    };
    const downloadedListener = (event: UpdateDownloadedEvent): void => {
      try {
        downloadedVersion = UpdateVersionSchema.parse(event.version);
      } catch {
        downloadedVersion = undefined;
      }
    };
    this.#client.on("download-progress", progressListener);
    this.#client.on("update-downloaded", downloadedListener);
    try {
      await this.#client.downloadUpdate();
      if (downloadedVersion !== version) return "failed";
      this.#downloadedVersion = version;
      onProgress(100);
      return "ready";
    } catch {
      return "failed";
    } finally {
      this.#client.removeListener("download-progress", progressListener);
      this.#client.removeListener("update-downloaded", downloadedListener);
    }
  }
}
