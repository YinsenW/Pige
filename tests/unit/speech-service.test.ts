import { describe, expect, it } from "vitest";
import type { SpeechAssetInstallEvent, SpeechSessionEvent } from "@pige/contracts";
import {
  SpeechService,
  type SpeechNativePort,
  type SpeechNativeProbeResult,
  type SpeechPermissionPort
} from "../../apps/desktop/src/main/services/speech-service";

const request = { requestId: `speechreq_${"a".repeat(16)}`, languageTag: "en-US" } as const;
const assetRequest = { requestId: `speechasset_${"a".repeat(16)}`, languageTag: "en-US" } as const;

describe("speech service", () => {
  it("projects helper-owned permission without prompting during availability", async () => {
    const native = new FakeNative();
    const permission = new FakePermission();
    native.probeResult = { status: "supported", permission: "not-determined" };
    const service = createService(native, permission);

    await expect(service.availability({ languageTag: "en-US" })).resolves.toMatchObject({
      status: "supported",
      permission: "not-determined"
    });
    await expect(service.start(7, request, () => undefined)).resolves.toMatchObject({
      status: "started",
      metering: "available"
    });
  });

  it("fails closed off macOS and for denied permission", async () => {
    const unsupportedNative = new FakeNative();
    const unsupported = new SpeechService({
      native: unsupportedNative,
      permission: new FakePermission(),
      platform: "win32",
      systemVersion: "26.0"
    });
    await expect(unsupported.availability({ languageTag: "en-US" })).resolves.toEqual({
      status: "unsupported",
      reason: "unsupported_platform",
      canOpenSystemSettings: false
    });
    await expect(unsupported.installLanguageAsset(1, assetRequest, () => undefined)).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.unsupported_platform", retryable: false }
    });
    expect(unsupportedNative.installCount).toBe(0);

    const permission = new FakePermission();
    const deniedNative = new FakeNative();
    deniedNative.probeResult = { status: "supported", permission: "denied" };
    const denied = createService(deniedNative, permission);
    await expect(denied.start(1, request, () => undefined)).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.permission_denied", userAction: "open_settings" }
    });

    const deniedOnDemandNative = new FakeNative();
    deniedOnDemandNative.probeResult = { status: "supported", permission: "not-determined" };
    deniedOnDemandNative.startResult = { status: "blocked", reason: "permission_denied" };
    await expect(createService(deniedOnDemandNative, permission).start(2, request, () => undefined)).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.permission_denied", userAction: "open_settings" }
    });
  });

  it("publishes monotonic meter and replacement transcript events and retains the final transcript", async () => {
    const native = new FakeNative();
    const service = createService(native, new FakePermission());
    const events: SpeechSessionEvent[] = [];
    const started = await service.start(3, request, (event) => events.push(event));
    if (started.status !== "started") throw new Error("session did not start");

    native.emitMeter(110, 0.25);
    native.emitMeter(90, 0.9);
    native.emitTranscript("hello");
    native.emitTranscript("hello");
    native.emitMeter(220, 4);
    native.finalTranscript = "hello world";
    const stopped = await service.stop(3, { sessionId: started.sessionId });

    expect(stopped).toMatchObject({
      status: "stopped",
      sequence: 4,
      transcript: "hello world"
    });
    expect(events).toEqual([
      expect.objectContaining({ kind: "meter", sequence: 1, elapsedMs: 110, level: 0.25 }),
      expect.objectContaining({ kind: "transcript_replace", sequence: 2, transcript: "hello", final: false }),
      expect.objectContaining({ kind: "meter", sequence: 3, elapsedMs: 220, level: 1 }),
      expect.objectContaining({ kind: "transcript_replace", sequence: 4, transcript: "hello world", final: true })
    ]);
  });

  it("enforces one owner and closes sessions on cancel or renderer destruction", async () => {
    const native = new FakeNative();
    const service = createService(native, new FakePermission());
    const started = await service.start(11, request, () => undefined);
    if (started.status !== "started") throw new Error("session did not start");

    await expect(service.start(12, { ...request, requestId: `speechreq_${"b".repeat(16)}` }, () => undefined))
      .resolves.toMatchObject({ status: "blocked", error: { code: "speech.session_busy" } });
    await expect(service.stop(12, { sessionId: started.sessionId })).resolves.toEqual({
      status: "stale_session",
      sessionId: started.sessionId
    });
    await service.cancelOwner(11);
    expect(native.cancelCount).toBe(1);
    await expect(service.cancel(11, { sessionId: started.sessionId })).resolves.toEqual({
      status: "stale_session",
      sessionId: started.sessionId
    });
  });

  it("serializes concurrent starts before permission and native ownership are established", async () => {
    const native = new FakeNative();
    let releaseProbe: (() => void) | undefined;
    native.probeDelay = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const service = createService(native, new FakePermission());
    const first = service.start(21, request, () => undefined);
    await Promise.resolve();
    await expect(service.start(22, { ...request, requestId: `speechreq_${"c".repeat(16)}` }, () => undefined))
      .resolves.toMatchObject({ status: "blocked", error: { code: "speech.session_busy" } });
    releaseProbe?.();
    await expect(first).resolves.toMatchObject({ status: "started" });
  });

  it("cancels an owner-bound pending start before microphone capture can become active", async () => {
    const native = new FakeNative();
    let releaseStart: (() => void) | undefined;
    native.startDelay = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = createService(native, new FakePermission());
    const starting = service.start(31, request, () => undefined);
    await native.startEntered;
    await service.cancelOwner(31);
    releaseStart?.();
    await expect(starting).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.start_canceled" }
    });
    expect(native.cancelCount).toBeGreaterThanOrEqual(1);
  });

  it("cancels the exact pending request before the renderer receives a session id", async () => {
    const native = new FakeNative();
    let releaseStart: (() => void) | undefined;
    native.startDelay = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = createService(native, new FakePermission());
    const starting = service.start(32, request, () => undefined);
    await native.startEntered;
    await expect(service.cancel(32, { requestId: request.requestId })).resolves.toEqual({
      status: "canceled",
      requestId: request.requestId
    });
    releaseStart?.();
    await expect(starting).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.start_canceled" }
    });
    expect(native.cancelCount).toBeGreaterThanOrEqual(1);
  });

  it("shares one finalization result across concurrent stop calls", async () => {
    const native = new FakeNative();
    let releaseStop: (() => void) | undefined;
    native.stopDelay = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });
    const service = createService(native, new FakePermission());
    const started = await service.start(41, request, () => undefined);
    if (started.status !== "started") throw new Error("session did not start");

    const first = service.stop(41, { sessionId: started.sessionId });
    const second = service.stop(41, { sessionId: started.sessionId });
    releaseStop?.();
    const [left, right] = await Promise.all([first, second]);

    expect(left).toEqual(right);
    expect(left).toMatchObject({ status: "stopped", transcript: "final" });
    expect(native.stopCount).toBe(1);
  });

  it("installs one explicit language asset with monotonic bounded progress", async () => {
    const native = new FakeNative();
    native.probeResult = { status: "unsupported", reason: "assets_unavailable", permission: "not-determined" };
    let releaseInstall: (() => void) | undefined;
    native.installDelay = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const service = createService(native, new FakePermission());
    const events: SpeechAssetInstallEvent[] = [];
    const started = await service.installLanguageAsset(51, assetRequest, (event) => events.push(event));
    expect(started).toMatchObject({
      status: "started",
      requestId: assetRequest.requestId,
      installationId: expect.stringMatching(/^speechinstall_[a-z0-9]{16,64}$/u),
      metering: "available"
    });
    await native.installEntered;

    native.emitInstallProgress(0.04);
    native.emitInstallProgress(0.04);
    native.emitInstallProgress(0.02);
    native.emitInstallProgress(1.4);
    releaseInstall?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(events).toEqual([
      expect.objectContaining({ kind: "progress", sequence: 1, completedFraction: 0.04 }),
      expect.objectContaining({ kind: "progress", sequence: 2, completedFraction: 1 }),
      expect.objectContaining({ kind: "installed", sequence: 3, languageTag: "en-US" })
    ]);
  });

  it("serializes asset installation with sessions and ignores another renderer teardown", async () => {
    const native = new FakeNative();
    native.probeResult = { status: "unsupported", reason: "assets_unavailable", permission: "not-determined" };
    let releaseInstall: (() => void) | undefined;
    native.installDelay = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    const service = createService(native, new FakePermission());
    const events: SpeechAssetInstallEvent[] = [];
    const started = await service.installLanguageAsset(61, assetRequest, (event) => events.push(event));
    if (started.status !== "started") throw new Error("asset installation did not start");
    await native.installEntered;

    await expect(service.start(61, { ...request, requestId: `speechreq_${"b".repeat(16)}` }, () => undefined))
      .resolves.toMatchObject({ status: "blocked", error: { code: "speech.session_busy" } });
    await service.cancelOwner(62);
    expect(native.abandonAssetInstallCount).toBe(0);
    releaseInstall?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(events).toEqual([
      expect.objectContaining({ kind: "installed", installationId: started.installationId, sequence: 1 })
    ]);
  });

  it("abandons an owned helper on renderer destruction without releasing the slot early", async () => {
    const native = new FakeNative();
    native.probeResult = { status: "unsupported", reason: "assets_unavailable", permission: "not-determined" };
    let releaseInstall: (() => void) | undefined;
    let releaseAbandon: (() => void) | undefined;
    native.installDelay = new Promise<void>((resolve) => {
      releaseInstall = resolve;
    });
    native.abandonDelay = new Promise<void>((resolve) => {
      releaseAbandon = resolve;
    });
    const service = createService(native, new FakePermission());
    const events: SpeechAssetInstallEvent[] = [];
    await expect(service.installLanguageAsset(63, assetRequest, (event) => events.push(event)))
      .resolves.toMatchObject({ status: "started" });
    await native.installEntered;

    const abandoning = service.cancelOwner(63);
    await native.abandonEntered;
    const alsoAbandoning = service.cancelOwner(63);
    await expect(service.start(
      64,
      { ...request, requestId: `speechreq_${"e".repeat(16)}` },
      () => undefined
    )).resolves.toMatchObject({ status: "blocked", error: { code: "speech.session_busy" } });
    await expect(service.installLanguageAsset(
      64,
      { ...assetRequest, requestId: `speechasset_${"e".repeat(16)}` },
      () => undefined
    )).resolves.toMatchObject({ status: "blocked", error: { code: "speech.asset_install_busy" } });
    releaseAbandon?.();
    await Promise.all([abandoning, alsoAbandoning]);
    releaseInstall?.();
    await Promise.resolve();

    expect(native.abandonAssetInstallCount).toBe(2);
    expect(events).toEqual([]);
    native.installDelay = undefined;
    await expect(service.installLanguageAsset(
      64,
      { ...assetRequest, requestId: `speechasset_${"c".repeat(16)}` },
      () => undefined
    )).resolves.toMatchObject({ status: "started" });
  });

  it("fails language asset installation closed without leaking native failures", async () => {
    const native = new FakeNative();
    native.probeResult = { status: "unsupported", reason: "assets_unavailable", permission: "not-determined" };
    native.installFailure = true;
    const service = createService(native, new FakePermission());
    const events: SpeechAssetInstallEvent[] = [];
    await expect(service.installLanguageAsset(71, assetRequest, (event) => events.push(event)))
      .resolves.toMatchObject({ status: "started", requestId: assetRequest.requestId });
    await native.installEntered;
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual([
      expect.objectContaining({
        kind: "failed",
        error: expect.objectContaining({ code: "speech.asset_install_failed", userAction: "retry" })
      })
    ]);
  });

  it("preflights the exact language and installs only when its native assets are unavailable", async () => {
    const installed = new FakeNative();
    const installedService = createService(installed, new FakePermission());
    await expect(installedService.installLanguageAsset(81, assetRequest, () => undefined)).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.asset_already_installed", retryable: false }
    });
    expect(installed.installCount).toBe(0);

    const unavailable = new FakeNative();
    unavailable.probeResult = {
      status: "unsupported",
      reason: "language_unavailable",
      permission: "not-determined"
    };
    await expect(createService(unavailable, new FakePermission()).installLanguageAsset(
      82,
      { ...assetRequest, requestId: `speechasset_${"d".repeat(16)}` },
      () => undefined
    )).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.language_unavailable", retryable: false }
    });
    expect(unavailable.installCount).toBe(0);
  });

  it("does not start a download when its renderer is destroyed during asset preflight", async () => {
    const native = new FakeNative();
    native.probeResult = { status: "unsupported", reason: "assets_unavailable", permission: "not-determined" };
    let releaseProbe: (() => void) | undefined;
    native.probeDelay = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    const service = createService(native, new FakePermission());
    const starting = service.installLanguageAsset(83, assetRequest, () => undefined);
    await Promise.resolve();

    await service.cancelOwner(83);
    releaseProbe?.();

    await expect(starting).resolves.toMatchObject({
      status: "blocked",
      error: { code: "speech.asset_install_canceled" }
    });
    expect(native.installCount).toBe(0);
  });
});

class FakeNative implements SpeechNativePort {
  finalTranscript = "final";
  cancelCount = 0;
  abandonAssetInstallCount = 0;
  installCount = 0;
  probeResult: SpeechNativeProbeResult = { status: "supported", permission: "granted" };
  probeDelay: Promise<void> | undefined;
  startResult: Awaited<ReturnType<SpeechNativePort["start"]>> = { status: "started", metering: "available" };
  startDelay: Promise<void> | undefined;
  installDelay: Promise<void> | undefined;
  abandonDelay: Promise<void> | undefined;
  installFailure = false;
  stopDelay: Promise<void> | undefined;
  stopCount = 0;
  readonly startEntered: Promise<void>;
  readonly installEntered: Promise<void>;
  readonly abandonEntered: Promise<void>;
  #markStartEntered: (() => void) | undefined;
  #markInstallEntered: (() => void) | undefined;
  #markAbandonEntered: (() => void) | undefined;
  #transcript: ((value: string) => void) | undefined;
  #meter: ((elapsedMs: number, level: number) => void) | undefined;
  #installProgress: ((progress: number) => void) | undefined;

  constructor() {
    this.startEntered = new Promise<void>((resolve) => {
      this.#markStartEntered = resolve;
    });
    this.installEntered = new Promise<void>((resolve) => {
      this.#markInstallEntered = resolve;
    });
    this.abandonEntered = new Promise<void>((resolve) => {
      this.#markAbandonEntered = resolve;
    });
  }

  async probe(): Promise<SpeechNativeProbeResult> {
    await this.probeDelay;
    return this.probeResult;
  }

  async start(input: Parameters<SpeechNativePort["start"]>[0]): ReturnType<SpeechNativePort["start"]> {
    this.#markStartEntered?.();
    await this.startDelay;
    this.#transcript = input.onTranscript;
    this.#meter = input.onMeter;
    return this.startResult;
  }

  async installLanguageAsset(
    input: Parameters<SpeechNativePort["installLanguageAsset"]>[0]
  ): ReturnType<SpeechNativePort["installLanguageAsset"]> {
    this.installCount += 1;
    this.#installProgress = input.onProgress;
    this.#markInstallEntered?.();
    await this.installDelay;
    if (this.installFailure) throw new Error("private native failure");
  }

  async abandonLanguageAssetInstall(): Promise<void> {
    this.abandonAssetInstallCount += 1;
    this.#markAbandonEntered?.();
    await this.abandonDelay;
  }

  async stop(): Promise<string> {
    this.stopCount += 1;
    await this.stopDelay;
    return this.finalTranscript;
  }

  async cancel(): Promise<void> {
    this.cancelCount += 1;
  }

  emitTranscript(value: string): void {
    this.#transcript?.(value);
  }

  emitMeter(elapsedMs: number, level: number): void {
    this.#meter?.(elapsedMs, level);
  }

  emitInstallProgress(progress: number): void {
    this.#installProgress?.(progress);
  }
}

class FakePermission implements SpeechPermissionPort {
  canOpenSystemSettings(): boolean {
    return true;
  }

  async openSystemSettings(): Promise<boolean> {
    return true;
  }
}

function createService(native: SpeechNativePort, permission: SpeechPermissionPort): SpeechService {
  return new SpeechService({ native, permission, platform: "darwin", systemVersion: "26.5.2" });
}
