import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { UpdateCheckResult } from "electron-updater";
import { ElectronUpdaterAdapter } from "../../apps/desktop/src/main/services/electron-updater-adapter";

describe("electron updater adapter", () => {
  it("keeps development and unsupported platforms network-free", async () => {
    const client = new FakeUpdaterClient();
    const development = new ElectronUpdaterAdapter({ isPackaged: false, platform: "darwin", client });
    await expect(development.check({ channel: "alpha", currentVersion: "0.1.0-alpha.1" }))
      .resolves.toEqual({ status: "unavailable" });
    expect(client.checkCount).toBe(0);

    const unsupported = new ElectronUpdaterAdapter({ isPackaged: true, platform: "linux", client });
    await expect(unsupported.check({ channel: "alpha", currentVersion: "0.1.0-alpha.1" }))
      .resolves.toEqual({ status: "unavailable" });
    expect(client.checkCount).toBe(0);
  });

  it("configures explicit signed update control and applies only the checked exact version", async () => {
    const client = new FakeUpdaterClient();
    client.nextVersion = "0.2.0-alpha.1";
    const adapter = new ElectronUpdaterAdapter({ isPackaged: true, platform: "darwin", client });
    expect(client).toMatchObject({
      autoDownload: false,
      autoInstallOnAppQuit: false,
      allowPrerelease: true,
      allowDowngrade: false,
      disableWebInstaller: true,
      logger: null
    });
    await expect(adapter.check({ channel: "alpha", currentVersion: "0.1.0-alpha.1" }))
      .resolves.toEqual({ status: "available", availableVersion: "0.2.0-alpha.1" });

    const progress: number[] = [];
    await expect(adapter.download({
      version: "0.2.0-alpha.1",
      onProgress: (percent) => progress.push(percent)
    })).resolves.toBe("ready");
    expect(progress).toEqual([35, 100]);
    expect(adapter.apply("0.2.0-alpha.2")).toBe(false);
    expect(adapter.apply("0.2.0-alpha.1")).toBe(true);
    expect(client.applyCount).toBe(1);
  });

  it("fails body-free on version drift and adopts an exact cached download after restart", async () => {
    const drifted = new FakeUpdaterClient();
    drifted.nextVersion = "0.3.0-alpha.1";
    const adapter = new ElectronUpdaterAdapter({ isPackaged: true, platform: "darwin", client: drifted });
    await expect(adapter.prepareApply("0.2.0-alpha.1")).resolves.toBe("failed");
    expect(adapter.apply("0.2.0-alpha.1")).toBe(false);

    const cached = new FakeUpdaterClient();
    cached.nextVersion = "0.2.0-alpha.1";
    const adopted = new ElectronUpdaterAdapter({ isPackaged: true, platform: "darwin", client: cached });
    await expect(adopted.prepareApply("0.2.0-alpha.1")).resolves.toBe("ready");
    expect(adopted.apply("0.2.0-alpha.1")).toBe(true);
  });
});

class FakeUpdaterClient extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  allowDowngrade = true;
  disableWebInstaller = false;
  logger: null = null;
  nextVersion: string | undefined;
  checkCount = 0;
  applyCount = 0;

  async checkForUpdates(): Promise<UpdateCheckResult | null> {
    this.checkCount += 1;
    if (!this.nextVersion) return null;
    return {
      isUpdateAvailable: true,
      updateInfo: { version: this.nextVersion }
    } as unknown as UpdateCheckResult;
  }

  async downloadUpdate(): Promise<readonly string[]> {
    this.emit("download-progress", { percent: 35 });
    this.emit("update-downloaded", { version: this.nextVersion });
    return [];
  }

  quitAndInstall(): void {
    this.applyCount += 1;
  }
}
